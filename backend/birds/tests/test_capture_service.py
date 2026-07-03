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
def test_create_capture_never_enforces_plausibility_on_out_of_range_weight(
    species, scientist, ringing_station, organization
):
    """The capture service runs no plausibility check (PRD #245, ADR 0021): a
    resolved capture with a wildly out-of-range Gewicht persists unchanged, so
    an IWM-imported historical row that is legitimately "unusual" never blocks."""
    entry = create_capture(
        **_capture_kwargs(
            species,
            scientist,
            ringing_station,
            organization,
            ring_number="810",
            weight_gram=Decimal("250.0"),
        )
    )

    assert entry.weight_gram == Decimal("250.0")


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
def test_create_capture_concurrent_second_erstfang_is_flagged_not_silently_duplicated(
    monkeypatch, species, scientist, ringing_station, organization
):
    """AC3 concurrency backstop (issue #164, PRD #152): two offline devices at one
    Organisation each record an Erstfang on the same ring number (each with its own
    idempotency_key) and reconnect near-simultaneously. Both requests can run the
    check-then-insert pre-check SELECT before either commits, so the
    at-most-one-Erstfang-per-ring rule cannot rest on that SELECT alone — it would
    let both INSERT and silently double-file one physical ring, exactly what AC3
    forbids. A partial unique index on ``ring`` where ``bird_status='e'`` is the
    real backstop: the losing INSERT hits it, and the resulting ``IntegrityError``
    is turned into the same flagged ``CaptureValidationError`` the sequential case
    raises — one surfaced sync error, never a silent second Erstfang.

    Simulated deterministically (no real threads, no flaky SQLite file-locking): a
    "concurrent winner" Erstfang is created first, then the losing request's
    ring-Erstfang pre-check SELECT is forced to miss exactly once — reproducing its
    view of the world at the instant it read "no rival Erstfang" — before it tries
    to insert a second Erstfang onto the same ring.
    """
    winner = create_capture(
        **_capture_kwargs(
            species,
            scientist,
            ringing_station,
            organization,
            ring_number="840",
            idempotency_key=uuid.uuid4(),
        )
    )

    real_filter = DataEntry.objects.filter
    precheck = {"missed": False}

    def _erstfang_precheck_misses_once(*args, **kwargs):
        # Only the ring-Erstfang pre-check names ``bird_status``; force it to
        # miss exactly once, leaving the idempotency lookups and the except-block
        # rival re-check on the real, winner-visible data.
        if "bird_status" in kwargs and not precheck["missed"]:
            precheck["missed"] = True
            return DataEntry.objects.none()
        return real_filter(*args, **kwargs)

    monkeypatch.setattr(DataEntry.objects, "filter", _erstfang_precheck_misses_once)

    with pytest.raises(CaptureValidationError) as exc_info:
        create_capture(
            **_capture_kwargs(
                species,
                scientist,
                ringing_station,
                organization,
                ring_number="840",
                idempotency_key=uuid.uuid4(),
            )
        )

    assert exc_info.value.field == "ring_number"
    assert exc_info.value.message == capture_service.RING_ALREADY_FIRST_CAUGHT
    # The silent duplicate AC3 forbids never materialised: still exactly one
    # Erstfang on the physical ring, and the winner is untouched.
    assert (
        DataEntry.objects.filter(
            ring__number="840", bird_status=DataEntry.BirdStatus.FIRST_CATCH
        ).count()
        == 1
    )
    assert DataEntry.objects.filter(id=winner.id).exists()
    assert DataEntry.objects.count() == 1


@pytest.mark.django_db
def test_erstfang_per_ring_uniqueness_is_enforced_at_the_database(
    species, scientist, ringing_station, organization
):
    """The at-most-one-Erstfang-per-ring rule has a DB constraint behind it, not
    just the application-level check-then-insert: two Erstfänge on one Ring row are
    rejected by the database even when ``create_capture``'s pre-check is bypassed
    (a direct ORM write — admin repair, a raced INSERT). This is the invariant AC3
    leans on to guarantee a concurrent duplicate is flagged, never silently lost.
    """
    ring = Ring.objects.create(number="850", size=Ring.RingSizes.V, organization=organization)
    DataEntry.objects.create(
        species=species,
        ring=ring,
        staff=scientist,
        ringing_station=ringing_station,
        organization=organization,
        bird_status=DataEntry.BirdStatus.FIRST_CATCH,
        date_time=datetime(2026, 3, 1, 12, 0, tzinfo=UTC),
    )

    with pytest.raises(capture_service.IntegrityError):
        DataEntry.objects.create(
            species=species,
            ring=ring,
            staff=scientist,
            ringing_station=ringing_station,
            organization=organization,
            bird_status=DataEntry.BirdStatus.FIRST_CATCH,
            date_time=datetime(2026, 3, 2, 12, 0, tzinfo=UTC),
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


# --- Zentrale write path (ADR 0019, issue #229) ------------------------------
# The backend-owned rules the shared capture service enforces so offline replay
# and the IWM import obey them identically: an explicit foreign Zentrale, the
# Projekt-Zentrale default, status gating and conditional Ringgröße validation.


def _central(scheme_code):
    from birds.models import Central

    return Central.objects.get(scheme_code=scheme_code)


@pytest.mark.django_db
def test_create_capture_foreign_wiederfang_creates_ring_under_that_zentrale(
    species, scientist, ringing_station, organization
):
    """A Wiederfang carrying a known foreign Zentrale creates a Ring under that
    Zentrale, with a free-text Größe and an alphanumeric Nummer (US 1, 6, 7)."""
    skb = _central("SKB")

    entry = create_capture(
        **_capture_kwargs(
            species,
            scientist,
            ringing_station,
            organization,
            ring_size="6.0",
            ring_number="SK123A",
            central=skb,
            bird_status=DataEntry.BirdStatus.RE_CATCH,
        )
    )

    assert entry.ring.central == skb
    assert entry.ring.size == "6.0"
    assert entry.ring.number == "SK123A"


@pytest.mark.django_db
def test_create_capture_defaults_missing_central_to_projekt_zentrale(
    species, scientist, ringing_station, organization, project
):
    """An omitted central defaults to the Projekt-Zentrale — the load-bearing
    behaviour a pre-feature offline outbox entry relies on (US 16)."""
    entry = create_capture(
        **_capture_kwargs(
            species, scientist, ringing_station, organization, ring_number="770", project=project
        )
    )

    assert entry.ring.central == project.central
    assert entry.ring.central.scheme_code == "AUW"


@pytest.mark.django_db
def test_create_capture_erstfang_with_foreign_central_is_rejected(
    species, scientist, ringing_station, organization, project
):
    """An Erstfang must carry the Projekt-Zentrale; a foreign one is refused with
    a German detail message and writes nothing (US 3)."""
    skb = _central("SKB")

    with pytest.raises(CaptureValidationError) as exc_info:
        create_capture(
            **_capture_kwargs(
                species,
                scientist,
                ringing_station,
                organization,
                ring_number="771",
                project=project,
                central=skb,
                bird_status=DataEntry.BirdStatus.FIRST_CATCH,
            )
        )

    assert exc_info.value.field == "central"
    assert DataEntry.objects.count() == 0
    assert not Ring.objects.filter(number="771").exists()


@pytest.mark.django_db
def test_create_capture_ring_destroyed_with_foreign_central_is_rejected(
    sentinel_species, scientist, ringing_station, organization, project
):
    """A 'Ring vernichtet' record must carry the Projekt-Zentrale; a foreign one
    is refused (US 4)."""
    skb = _central("SKB")

    with pytest.raises(CaptureValidationError) as exc_info:
        create_capture(
            **_capture_kwargs(
                sentinel_species,
                scientist,
                ringing_station,
                organization,
                ring_number="772",
                project=project,
                central=skb,
            )
        )

    assert exc_info.value.field == "central"


@pytest.mark.django_db
def test_create_capture_auw_rejects_invalid_ring_size(
    species, scientist, ringing_station, organization
):
    """Under AUW the strict Austrian choice list still governs the Größe: a value
    outside the 28 codes is refused (US 8)."""
    with pytest.raises(CaptureValidationError) as exc_info:
        create_capture(
            **_capture_kwargs(
                species,
                scientist,
                ringing_station,
                organization,
                ring_size="ZZ",
                ring_number="773",
            )
        )

    assert exc_info.value.field == "ring_size"


@pytest.mark.django_db
def test_create_capture_foreign_size_is_trimmed_uppercased_and_capped(
    species, scientist, ringing_station, organization
):
    """A foreign Größe is free text — trimmed, uppercased and length-capped to
    FOREIGN_RING_SIZE_MAX_LENGTH (US 12)."""
    skb = _central("SKB")

    entry = create_capture(
        **_capture_kwargs(
            species,
            scientist,
            ringing_station,
            organization,
            ring_size="  abcdefghijklmnop  ",
            ring_number="774",
            central=skb,
            bird_status=DataEntry.BirdStatus.RE_CATCH,
        )
    )

    assert entry.ring.size == "ABCDEFGHIJ"[: capture_service.FOREIGN_RING_SIZE_MAX_LENGTH]
    assert len(entry.ring.size) == capture_service.FOREIGN_RING_SIZE_MAX_LENGTH


@pytest.mark.django_db
def test_create_capture_foreign_blank_size_is_rejected(
    species, scientist, ringing_station, organization
):
    """A foreign Größe is never empty: a blank (or whitespace-only) value is a
    validation error (US 12)."""
    skb = _central("SKB")

    with pytest.raises(CaptureValidationError) as exc_info:
        create_capture(
            **_capture_kwargs(
                species,
                scientist,
                ringing_station,
                organization,
                ring_size="   ",
                ring_number="775",
                central=skb,
                bird_status=DataEntry.BirdStatus.RE_CATCH,
            )
        )

    assert exc_info.value.field == "ring_size"


@pytest.mark.django_db
def test_create_capture_slovak_and_austrian_ring_same_number_coexist(
    species, scientist, ringing_station, organization
):
    """The same (Größe, Nummer) under two Zentralen are distinct physical rings:
    an Austrian S 0042 Erstfang and a Slovak S 0042 Wiederfang coexist (US 18)."""
    skb = _central("SKB")

    austrian = create_capture(
        **_capture_kwargs(
            species,
            scientist,
            ringing_station,
            organization,
            ring_size=Ring.RingSizes.S,
            ring_number="0042",
        )
    )
    slovak = create_capture(
        **_capture_kwargs(
            species,
            scientist,
            ringing_station,
            organization,
            ring_size="S",
            ring_number="0042",
            central=skb,
            bird_status=DataEntry.BirdStatus.RE_CATCH,
        )
    )

    assert austrian.ring_id != slovak.ring_id
    assert austrian.ring.central.scheme_code == "AUW"
    assert slovak.ring.central == skb
    assert (
        Ring.objects.filter(organization=organization, size=Ring.RingSizes.S, number="0042").count()
        == 2
    )


@pytest.mark.django_db
def test_create_capture_second_erstfang_same_zentrale_size_number_is_rejected(
    species, scientist, ringing_station, organization
):
    """A second Erstfang on the same (Zentrale, Größe, Nummer) within the
    Organisation is refused with the existing German message (US 17)."""
    create_capture(
        **_capture_kwargs(
            species,
            scientist,
            ringing_station,
            organization,
            ring_size=Ring.RingSizes.S,
            ring_number="0043",
        )
    )

    with pytest.raises(CaptureValidationError) as exc_info:
        create_capture(
            **_capture_kwargs(
                species,
                scientist,
                ringing_station,
                organization,
                ring_size=Ring.RingSizes.S,
                ring_number="0043",
            )
        )

    assert exc_info.value.message == capture_service.RING_ALREADY_FIRST_CAUGHT
