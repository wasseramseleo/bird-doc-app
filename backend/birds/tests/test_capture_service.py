from datetime import UTC, datetime
from decimal import Decimal

import pytest

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
def test_create_capture_attaches_project(
    species, scientist, ringing_station, organization, project
):
    entry = create_capture(
        **_capture_kwargs(
            species, scientist, ringing_station, organization, ring_number="705", project=project
        )
    )

    assert entry.project == project
