from datetime import UTC, datetime
from unittest.mock import MagicMock

import pytest

from birds.models import DataEntry, Project, Ring
from birds.serializers import DataEntrySerializer, ProjectSerializer


def _entry_payload(species, scientist, ringing_station, *, ring_number, ring_size=Ring.RingSizes.V):
    return {
        "species_id": species.id,
        "staff_id": scientist.id,
        "ringing_station_id": ringing_station.handle,
        "ring_number": ring_number,
        "ring_size": ring_size,
        "date_time": datetime(2026, 2, 1, 8, 0, tzinfo=UTC),
    }


@pytest.mark.django_db
def test_sentinel_entry_nulls_bird_data_even_when_payload_supplies_it(
    sentinel_species, scientist, ringing_station
):
    payload = _entry_payload(sentinel_species, scientist, ringing_station, ring_number="601")
    payload.update(
        {
            "age_class": DataEntry.AgeClass.THIS_YEAR,
            "sex": DataEntry.Sex.MALE,
            "bird_status": DataEntry.BirdStatus.FIRST_CATCH,
            "wing_span": "73.0",
            "weight_gram": "18.0",
            "tarsus": "19.0",
            "fat_deposit": 3,
            "comment": "Produktionsfehler",
        }
    )

    serializer = DataEntrySerializer(data=payload)
    assert serializer.is_valid(), serializer.errors
    entry = serializer.save()

    assert entry.age_class is None
    assert entry.sex is None
    assert entry.bird_status is None
    assert entry.wing_span is None
    assert entry.weight_gram is None
    assert entry.tarsus is None
    assert entry.fat_deposit is None
    # The destroyed-ring essentials survive.
    assert entry.ring.number == "601"
    assert entry.comment == "Produktionsfehler"


@pytest.mark.django_db
def test_unknown_species_rejects_blank_comment(aves_ignota_species, scientist, ringing_station):
    """An Aves-ignota capture is a real bird whose unusual catch must always be
    described, so a blank Bemerkung is rejected at the serializer layer."""
    payload = _entry_payload(aves_ignota_species, scientist, ringing_station, ring_number="610")

    serializer = DataEntrySerializer(data=payload)

    assert not serializer.is_valid()
    assert "comment" in serializer.errors


@pytest.mark.django_db
def test_unknown_species_rejects_whitespace_only_comment(
    aves_ignota_species, scientist, ringing_station
):
    payload = _entry_payload(aves_ignota_species, scientist, ringing_station, ring_number="611")
    payload["comment"] = "   "

    serializer = DataEntrySerializer(data=payload)

    assert not serializer.is_valid()
    assert "comment" in serializer.errors


@pytest.mark.django_db
def test_unknown_species_with_comment_is_created_and_keeps_bird_data(
    aves_ignota_species, scientist, ringing_station
):
    """With a Bemerkung the Aves-ignota capture is created, and — unlike a
    destroyed ring — it keeps its full bird data."""
    payload = _entry_payload(aves_ignota_species, scientist, ringing_station, ring_number="612")
    payload.update(
        {
            "age_class": DataEntry.AgeClass.THIS_YEAR,
            "sex": DataEntry.Sex.MALE,
            "bird_status": DataEntry.BirdStatus.FIRST_CATCH,
            "wing_span": "73.0",
            "comment": "Seltener Irrgast, nicht auf der Artenliste.",
        }
    )

    serializer = DataEntrySerializer(data=payload)
    assert serializer.is_valid(), serializer.errors
    entry = serializer.save()

    assert entry.comment == "Seltener Irrgast, nicht auf der Artenliste."
    assert entry.age_class == DataEntry.AgeClass.THIS_YEAR
    assert entry.sex == DataEntry.Sex.MALE
    assert entry.wing_span == 73.0


@pytest.mark.django_db
def test_normal_species_does_not_require_a_comment(species, scientist, ringing_station):
    """The mandatory-Bemerkung rule is scoped to unknown_species; a normal taxon
    is still creatable with no comment."""
    serializer = DataEntrySerializer(
        data=_entry_payload(species, scientist, ringing_station, ring_number="613")
    )

    assert serializer.is_valid(), serializer.errors


@pytest.mark.django_db
def test_normal_entry_keeps_its_bird_data(species, scientist, ringing_station):
    payload = _entry_payload(species, scientist, ringing_station, ring_number="602")
    payload.update(
        {
            "age_class": DataEntry.AgeClass.THIS_YEAR,
            "sex": DataEntry.Sex.MALE,
            "bird_status": DataEntry.BirdStatus.FIRST_CATCH,
            "wing_span": "73.0",
        }
    )

    serializer = DataEntrySerializer(data=payload)
    assert serializer.is_valid(), serializer.errors
    entry = serializer.save()

    assert entry.age_class == DataEntry.AgeClass.THIS_YEAR
    assert entry.sex == DataEntry.Sex.MALE
    assert entry.bird_status == DataEntry.BirdStatus.FIRST_CATCH
    assert entry.wing_span == 73.0


@pytest.mark.django_db
def test_create_reuses_existing_ring(species, scientist, ringing_station):
    existing = Ring.objects.create(number="500", size=Ring.RingSizes.V)

    serializer = DataEntrySerializer(
        data=_entry_payload(species, scientist, ringing_station, ring_number="500")
    )
    assert serializer.is_valid(), serializer.errors
    entry = serializer.save()

    assert entry.ring_id == existing.id
    assert Ring.objects.filter(number="500", size=Ring.RingSizes.V).count() == 1


@pytest.mark.django_db
def test_create_creates_new_ring_when_missing(species, scientist, ringing_station):
    serializer = DataEntrySerializer(
        data=_entry_payload(species, scientist, ringing_station, ring_number="777")
    )
    assert serializer.is_valid(), serializer.errors
    entry = serializer.save()

    assert Ring.objects.filter(number="777", size=Ring.RingSizes.V).exists()
    assert entry.ring.number == "777"


@pytest.mark.django_db
def test_update_deletes_orphaned_old_ring(data_entry, species, scientist, ringing_station):
    old_ring = data_entry.ring
    old_ring_id = old_ring.id

    serializer = DataEntrySerializer(
        instance=data_entry,
        data=_entry_payload(species, scientist, ringing_station, ring_number="999"),
    )
    assert serializer.is_valid(), serializer.errors
    serializer.save()

    assert not Ring.objects.filter(id=old_ring_id).exists()
    assert Ring.objects.filter(number="999", size=Ring.RingSizes.V).exists()


@pytest.mark.django_db
def test_update_keeps_old_ring_when_still_referenced(
    data_entry, species, scientist, ringing_station
):
    old_ring = data_entry.ring
    # A second capture keeps ``old_ring`` referenced after ``data_entry`` moves to
    # a new ring. ``data_entry`` is already the ring's Erstfang, so this one is a
    # Wiederfang — at most one Erstfang may reference a ring (unique_erstfang_per_ring,
    # issue #164), and a recapture referencing the ring is what the test needs.
    DataEntry.objects.create(
        species=species,
        ring=old_ring,
        staff=scientist,
        ringing_station=ringing_station,
        bird_status=DataEntry.BirdStatus.RE_CATCH,
        date_time=datetime(2026, 2, 2, 8, 0, tzinfo=UTC),
    )

    serializer = DataEntrySerializer(
        instance=data_entry,
        data=_entry_payload(species, scientist, ringing_station, ring_number="999"),
    )
    assert serializer.is_valid(), serializer.errors
    serializer.save()

    assert Ring.objects.filter(id=old_ring.id).exists()


@pytest.mark.django_db
def test_project_create_appends_creator_scientist(user, scientist, organization):
    request = MagicMock()
    request.user = user

    serializer = ProjectSerializer(
        data={"title": "P", "description": "", "organization_id": organization.handle},
        context={"request": request},
    )
    assert serializer.is_valid(), serializer.errors
    project = serializer.save()

    assert scientist in project.scientists.all()


@pytest.mark.django_db
def test_project_create_does_not_duplicate_creator(user, scientist, organization, other_scientist):
    request = MagicMock()
    request.user = user

    serializer = ProjectSerializer(
        data={
            "title": "P",
            "description": "",
            "organization_id": organization.handle,
            "scientist_ids": [scientist.id, other_scientist.id],
        },
        context={"request": request},
    )
    assert serializer.is_valid(), serializer.errors
    project = serializer.save()

    assert project.scientists.count() == 2
    assert scientist in project.scientists.all()
    assert other_scientist in project.scientists.all()


@pytest.mark.django_db
def test_project_create_without_scientist_user_does_not_crash(other_user, organization):
    request = MagicMock()
    request.user = other_user

    serializer = ProjectSerializer(
        data={"title": "P", "description": "", "organization_id": organization.handle},
        context={"request": request},
    )
    assert serializer.is_valid(), serializer.errors
    project = serializer.save()

    assert project.scientists.count() == 0
    assert Project.objects.filter(id=project.id).exists()
