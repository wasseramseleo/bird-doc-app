import uuid
from datetime import UTC, datetime
from decimal import Decimal

import pytest

from birds import capture_service
from birds.capture_service import CaptureValidationError, create_capture
from birds.models import DataEntry, Ring


def _capture_kwargs(species, scientist, ringing_station, organization, **overrides):
    """Resolved inputs for one capture, mirroring what the importer will pass.

    The IWM importer (issue #113) resolves species/Beringer/Station itself and
    hands the service already-resolved objects — never a DRF payload.
    """
    kwargs = {
        "species": species,
        "staff": scientist,
        "ringing_station": ringing_station,
        "organization": organization,
        "ring_size": Ring.RingSizes.V,
        "ring_number": "200",
        "date_time": datetime(2026, 3, 1, 12, 0, tzinfo=UTC),
    }
    kwargs.update(overrides)
    return kwargs


@pytest.mark.django_db
def test_create_capture_creates_org_scoped_ring_and_attaches_organisation(
    species, scientist, ringing_station, organization
):
    """The tracer bullet: a resolved capture becomes a DataEntry whose Ring is
    created within the given Organisation (ADR 0006) and whose owner is that org."""
    entry = create_capture(
        **_capture_kwargs(species, scientist, ringing_station, organization, ring_number="300")
    )

    assert isinstance(entry, DataEntry)
    ring = Ring.objects.get(number="300", size=Ring.RingSizes.V, organization=organization)
    assert entry.ring_id == ring.id
    assert entry.organization == organization
    assert entry.species == species


@pytest.mark.django_db
def test_create_capture_reuses_existing_org_ring(species, scientist, ringing_station, organization):
    """A ring already owned by the recording Organisation is reused, not duplicated."""
    existing = Ring.objects.create(number="400", size=Ring.RingSizes.V, organization=organization)

    entry = create_capture(
        **_capture_kwargs(species, scientist, ringing_station, organization, ring_number="400")
    )

    assert entry.ring_id == existing.id
    assert Ring.objects.filter(number="400", size=Ring.RingSizes.V).count() == 1


@pytest.mark.django_db
def test_create_capture_ring_lookup_is_scoped_to_the_organisation(
    species, scientist, ringing_station, organization, organization_b
):
    """A ring with the same (size, number) owned by another Organisation is not
    reused: a fresh Ring is created in the recording Organisation (ADR 0006)."""
    other = Ring.objects.create(number="500", size=Ring.RingSizes.V, organization=organization_b)

    entry = create_capture(
        **_capture_kwargs(species, scientist, ringing_station, organization, ring_number="500")
    )

    assert entry.ring_id != other.id
    assert entry.ring.organization == organization
    assert Ring.objects.filter(number="500", size=Ring.RingSizes.V).count() == 2


@pytest.mark.django_db
def test_create_capture_nulls_bird_data_for_ring_destroyed(
    sentinel_species, scientist, ringing_station, organization
):
    """A 'Ring Vernichtet' capture files no bird data — every bird-data field is
    nulled regardless of what the caller supplied (ADR 0004)."""
    entry = create_capture(
        **_capture_kwargs(
            sentinel_species,
            scientist,
            ringing_station,
            organization,
            ring_number="662",
            age_class=DataEntry.AgeClass.THIS_YEAR,
            sex=DataEntry.Sex.MALE,
            bird_status=DataEntry.BirdStatus.FIRST_CATCH,
            wing_span="73.0",
            weight_gram="18.0",
        )
    )

    assert entry.age_class is None
    assert entry.sex is None
    assert entry.bird_status is None
    assert entry.wing_span is None
    assert entry.weight_gram is None
    # The destroyed-ring essentials survive.
    assert entry.ring.number == "662"


@pytest.mark.django_db
def test_create_capture_aves_ignota_without_comment_raises_and_writes_nothing(
    aves_ignota_species, scientist, ringing_station, organization
):
    """Aves ignota with a blank Bemerkung is rejected before anything is written —
    not even the Ring is created (ADR 0004)."""
    with pytest.raises(CaptureValidationError) as excinfo:
        create_capture(
            **_capture_kwargs(
                aves_ignota_species,
                scientist,
                ringing_station,
                organization,
                ring_number="660",
            )
        )

    assert excinfo.value.field == "comment"
    assert DataEntry.objects.count() == 0
    assert not Ring.objects.filter(number="660").exists()


@pytest.mark.django_db
def test_create_capture_aves_ignota_whitespace_comment_is_rejected(
    aves_ignota_species, scientist, ringing_station, organization
):
    with pytest.raises(CaptureValidationError):
        create_capture(
            **_capture_kwargs(
                aves_ignota_species,
                scientist,
                ringing_station,
                organization,
                ring_number="663",
                comment="   ",
            )
        )


@pytest.mark.django_db
def test_create_capture_aves_ignota_with_comment_keeps_bird_data(
    aves_ignota_species, scientist, ringing_station, organization
):
    """With a Bemerkung the Aves-ignota capture is created and — unlike a
    destroyed ring — keeps its full bird data."""
    entry = create_capture(
        **_capture_kwargs(
            aves_ignota_species,
            scientist,
            ringing_station,
            organization,
            ring_number="661",
            comment="Irrgast, nicht auf der Artenliste.",
            age_class=DataEntry.AgeClass.THIS_YEAR,
            sex=DataEntry.Sex.MALE,
            wing_span=Decimal("73.0"),
        )
    )

    assert entry.comment == "Irrgast, nicht auf der Artenliste."
    assert entry.age_class == DataEntry.AgeClass.THIS_YEAR
    assert entry.sex == DataEntry.Sex.MALE
    assert entry.wing_span == Decimal("73.0")


@pytest.mark.django_db
def test_create_capture_concurrent_replay_returns_existing_row_not_error(
    monkeypatch, species, scientist, ringing_station, organization
):
    """#155 TOCTOU race: two near-simultaneous creates carrying the same
    idempotency_key (an offline-outbox retry firing while the first request is
    still in flight, PRD #152) can both pass the initial existence check before
    either commits — the second call's INSERT then hits the DB's
    ``unique_idempotency_key_per_organization`` constraint. This must return
    the winner's row, never raise ``IntegrityError``/500.

    Simulated deterministically (no real threads, no flaky SQLite
    file-locking): a "concurrent winner" row is created first, then the initial
    short-circuit lookup is forced to miss exactly once — reproducing the
    losing request's view of the world at the moment it read "no existing
    row" — before it tries to insert into an already-occupied key.
    """
    key = uuid.uuid4()
    winner = create_capture(
        **_capture_kwargs(
            species,
            scientist,
            ringing_station,
            organization,
            ring_number="900",
            idempotency_key=key,
        )
    )

    real_filter = DataEntry.objects.filter
    calls = {"n": 0}

    def _filter_missing_once(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            return DataEntry.objects.none()
        return real_filter(*args, **kwargs)

    monkeypatch.setattr(DataEntry.objects, "filter", _filter_missing_once)

    loser = create_capture(
        **_capture_kwargs(
            species,
            scientist,
            ringing_station,
            organization,
            ring_number="900",
            idempotency_key=key,
        )
    )

    assert loser.id == winner.id
    assert DataEntry.objects.count() == 1
    assert (
        Ring.objects.filter(number="900", size=Ring.RingSizes.V, organization=organization).count()
        == 1
    )


@pytest.mark.django_db
def test_create_capture_unrelated_integrity_error_still_raises(
    monkeypatch, species, scientist, ringing_station, organization
):
    """The IntegrityError recovery is scoped to a genuine idempotency-key
    replay: a key-less create can never hit that constraint, so an unrelated
    IntegrityError must propagate unchanged rather than being swallowed."""

    def _boom(*args, **kwargs):
        raise capture_service.IntegrityError("unrelated constraint violation")

    monkeypatch.setattr(DataEntry.objects, "create", _boom)

    with pytest.raises(capture_service.IntegrityError):
        create_capture(
            **_capture_kwargs(species, scientist, ringing_station, organization, ring_number="901")
        )


@pytest.mark.django_db
def test_create_capture_attaches_project(
    species, scientist, ringing_station, organization, project
):
    entry = create_capture(
        **_capture_kwargs(
            species, scientist, ringing_station, organization, ring_number="705", project=project
        )
    )

    assert entry.project == project


@pytest.mark.django_db
def test_create_capture_rejects_second_erstfang_on_same_org_ring(
    species, scientist, ringing_station, organization
):
    """A second Erstfang on a ring the Organisation already first-caught is a
    genuine ring-uniqueness collision (ADR 0006), not a reuse: it is refused so
    two concurrent offline devices converge on exactly one flagged sync error
    (issue #164, PRD #152), never a silent second Erstfang on one physical ring.

    The idempotency short-circuit runs first, so a genuine *replay* (same key)
    is unaffected — only two distinct create attempts (distinct keys) collide.
    """
    create_capture(
        **_capture_kwargs(
            species,
            scientist,
            ringing_station,
            organization,
            ring_number="830",
            idempotency_key=uuid.uuid4(),
        )
    )

    with pytest.raises(CaptureValidationError) as exc_info:
        create_capture(
            **_capture_kwargs(
                species,
                scientist,
                ringing_station,
                organization,
                ring_number="830",
                idempotency_key=uuid.uuid4(),
            )
        )

    assert exc_info.value.field == "ring_number"
    assert (
        DataEntry.objects.filter(
            ring__number="830", bird_status=DataEntry.BirdStatus.FIRST_CATCH
        ).count()
        == 1
    )


@pytest.mark.django_db
def test_create_capture_allows_wiederfang_on_already_first_caught_ring(
    species, scientist, ringing_station, organization
):
    """A recapture (Wiederfang) of an already-first-caught ring is expected —
    it is never treated as a ring-uniqueness collision and must still create."""
    create_capture(
        **_capture_kwargs(species, scientist, ringing_station, organization, ring_number="831")
    )

    entry = create_capture(
        **_capture_kwargs(
            species,
            scientist,
            ringing_station,
            organization,
            ring_number="831",
            bird_status=DataEntry.BirdStatus.RE_CATCH,
        )
    )

    assert entry.bird_status == DataEntry.BirdStatus.RE_CATCH


@pytest.mark.django_db
def test_create_capture_erstfang_allowed_when_other_org_first_caught_same_number(
    species, scientist, ringing_station, organization, organization_b
):
    """Ring uniqueness is org-scoped (ADR 0006): another Organisation having
    first-caught the same (size, number) never blocks this Organisation's own
    first Erstfang on that number — the rings are two different rows."""
    other_ring = Ring.objects.create(
        number="832", size=Ring.RingSizes.V, organization=organization_b
    )
    DataEntry.objects.create(
        species=species,
        ring=other_ring,
        staff=scientist,
        ringing_station=ringing_station,
        organization=organization_b,
        bird_status=DataEntry.BirdStatus.FIRST_CATCH,
        date_time=datetime(2026, 3, 1, 12, 0, tzinfo=UTC),
    )

    entry = create_capture(
        **_capture_kwargs(species, scientist, ringing_station, organization, ring_number="832")
    )

    assert entry.bird_status == DataEntry.BirdStatus.FIRST_CATCH
    assert entry.ring.organization == organization
