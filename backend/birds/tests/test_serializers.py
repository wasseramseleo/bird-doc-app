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
    DataEntry.objects.create(
        species=species,
        ring=old_ring,
        staff=scientist,
        ringing_station=ringing_station,
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
def test_project_create_does_not_duplicate_creator(
    user, scientist, organization, other_scientist
):
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
