import importlib
import uuid
from datetime import UTC, datetime
from decimal import Decimal

import pytest
from django.apps import apps as global_apps
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError

from birds.models import (
    DataEntry,
    Organization,
    Project,
    Ring,
    RingingStation,
    Scientist,
    Species,
    SpeciesList,
)

seed_migration = importlib.import_module(
    "birds.migrations.0034_seed_iwm_station_and_project_context"
)


@pytest.mark.django_db
def test_data_migration_converts_sentinel_to_ring_destroyed():
    rows = Species.objects.filter(special_kind=Species.SpecialKind.RING_DESTROYED)

    assert rows.count() == 1
    assert rows.first().common_name_de == "Ring Vernichtet"


@pytest.mark.django_db
def test_data_migration_creates_single_aves_ignota_unknown_species():
    rows = Species.objects.filter(special_kind=Species.SpecialKind.UNKNOWN_SPECIES)

    assert rows.count() == 1
    row = rows.first()
    assert row.common_name_de == "Art nicht in der Liste (Aves ignota)"
    assert row.scientific_name == "Aves ignota"
    assert row.common_name_en == "Species not listed"
    assert row.ring_size is None


@pytest.mark.django_db
def test_data_migration_creates_single_fallback_beringer():
    fallback = Scientist.objects.filter(handle="GELÖSCHT")

    assert fallback.count() == 1
    assert fallback.first().full_name == "Gelöschter Nutzer"


@pytest.mark.django_db
def test_deleting_beringer_with_captures_reassigns_them_to_fallback(data_entry):
    beringer = data_entry.staff

    beringer.delete()

    data_entry.refresh_from_db()
    fallback = Scientist.objects.get(handle="GELÖSCHT")
    assert data_entry.staff == fallback
    assert not Scientist.objects.filter(pk=beringer.pk).exists()


@pytest.mark.django_db
def test_fallback_beringer_cannot_be_deleted():
    # The reserved sink itself must survive — deleting it would orphan every
    # capture that was reassigned to it. (atomic() contains the rollback so the
    # surrounding test transaction stays usable after the blocked delete.)
    fallback = Scientist.objects.get(handle="GELÖSCHT")

    with pytest.raises(ProtectedError), transaction.atomic():
        fallback.delete()

    assert Scientist.objects.filter(handle="GELÖSCHT").exists()


@pytest.mark.django_db
def test_fallback_beringer_cannot_be_bulk_deleted():
    # The guard fires on the queryset (bulk) delete path too, not just on a
    # single instance — the admin bulk action must not wipe the sink either.
    with pytest.raises(ProtectedError), transaction.atomic():
        Scientist.objects.filter(handle="GELÖSCHT").delete()

    assert Scientist.objects.filter(handle="GELÖSCHT").exists()


@pytest.mark.django_db
def test_bulk_deleting_beringers_reassigns_captures_to_fallback(data_entry):
    # The admin bulk-delete action runs a queryset .delete() — a distinct Django
    # deletion path from a single instance. on_delete=SET reassigns either way.
    beringer = data_entry.staff

    Scientist.objects.filter(pk=beringer.pk).delete()

    data_entry.refresh_from_db()
    assert data_entry.staff.handle == "GELÖSCHT"
    assert Scientist.objects.filter(handle="GELÖSCHT").count() == 1


@pytest.mark.django_db
def test_scientist_derives_kuerzel_on_save_when_blank():
    beringer = Scientist.objects.create(first_name="Filip", last_name="Reiter")

    assert beringer.handle == "FRE"


@pytest.mark.django_db
def test_scientist_keeps_supplied_kuerzel_on_save():
    beringer = Scientist.objects.create(first_name="Filip", last_name="Reiter", handle="XYZ")

    assert beringer.handle == "XYZ"


@pytest.mark.django_db
def test_activating_list_deactivates_other_lists_for_same_user(user):
    a = SpeciesList.objects.create(name="A", user=user, is_active=True)
    b = SpeciesList.objects.create(name="B", user=user, is_active=True)

    a.refresh_from_db()
    assert a.is_active is False
    assert b.is_active is True


@pytest.mark.django_db
def test_activating_list_does_not_affect_other_users(user, other_user):
    other_active = SpeciesList.objects.create(name="X", user=other_user, is_active=True)
    SpeciesList.objects.create(name="A", user=user, is_active=True)

    other_active.refresh_from_db()
    assert other_active.is_active is True


@pytest.mark.django_db
def test_project_capture_context_defaults(organization):
    project = Project.objects.create(title="P", organization=organization)

    assert project.circumstance == "25"
    assert project.capture_method == "M"
    assert project.lure == "N"


@pytest.mark.django_db
def test_project_rejects_invalid_capture_method(organization):
    project = Project(title="P", organization=organization, capture_method="ZZ")

    with pytest.raises(ValidationError):
        project.full_clean()


@pytest.mark.django_db
def test_project_rejects_invalid_lure(organization):
    project = Project(title="P", organization=organization, lure="ZZ")

    with pytest.raises(ValidationError):
        project.full_clean()


@pytest.mark.django_db
def test_project_accepts_valid_capture_method_and_lure(organization):
    project = Project(title="P", organization=organization, capture_method="H", lure="A")

    project.full_clean()  # should not raise


@pytest.mark.django_db
def test_seed_migration_fills_existing_station_geography():
    org = Organization.objects.create(handle="SEED", name="Seed Org")
    station = RingingStation.objects.create(handle="SEEDSTN", name="Seed Station", organization=org)

    seed_migration.seed(global_apps, None)

    station.refresh_from_db()
    assert station.country == "Austria"
    assert station.region == "Oberösterreich"
    assert station.place_code == "AU03"
    assert station.latitude == Decimal("48.295892")
    assert station.longitude == Decimal("14.276697")


@pytest.mark.django_db
def test_seed_migration_fills_existing_project_capture_context():
    org = Organization.objects.create(handle="SEED2", name="Seed Org 2")
    project = Project.objects.create(
        title="Seed Project",
        organization=org,
        circumstance="",
        capture_method="Z",
        lure="U",
    )

    seed_migration.seed(global_apps, None)

    project.refresh_from_db()
    assert project.circumstance == "25"
    assert project.capture_method == "M"
    assert project.lure == "N"


@pytest.mark.django_db
def test_saving_inactive_list_does_not_deactivate_siblings(user):
    active = SpeciesList.objects.create(name="A", user=user, is_active=True)
    SpeciesList.objects.create(name="B", user=user, is_active=False)

    active.refresh_from_db()
    assert active.is_active is True


@pytest.mark.django_db
def test_idempotency_key_enforces_db_uniqueness(species, scientist, ringing_station):
    """#155: the uniqueness guarantee lives at the DB layer, not just in the
    view/serializer — a direct ORM create with a duplicate key is rejected."""
    key = uuid.uuid4()
    ring_a = Ring.objects.create(number="501", size=Ring.RingSizes.V)
    ring_b = Ring.objects.create(number="502", size=Ring.RingSizes.V)
    DataEntry.objects.create(
        species=species,
        ring=ring_a,
        staff=scientist,
        ringing_station=ringing_station,
        date_time=datetime(2026, 1, 1, tzinfo=UTC),
        idempotency_key=key,
    )

    with pytest.raises(IntegrityError), transaction.atomic():
        DataEntry.objects.create(
            species=species,
            ring=ring_b,
            staff=scientist,
            ringing_station=ringing_station,
            date_time=datetime(2026, 1, 1, tzinfo=UTC),
            idempotency_key=key,
        )


@pytest.mark.django_db
def test_idempotency_key_null_does_not_collide(species, scientist, ringing_station):
    """Absent keys (the pre-#155 default) never collide with one another."""
    ring_a = Ring.objects.create(number="503", size=Ring.RingSizes.V)
    ring_b = Ring.objects.create(number="504", size=Ring.RingSizes.V)

    DataEntry.objects.create(
        species=species,
        ring=ring_a,
        staff=scientist,
        ringing_station=ringing_station,
        date_time=datetime(2026, 1, 1, tzinfo=UTC),
    )
    DataEntry.objects.create(
        species=species,
        ring=ring_b,
        staff=scientist,
        ringing_station=ringing_station,
        date_time=datetime(2026, 1, 1, tzinfo=UTC),
    )

    assert DataEntry.objects.filter(idempotency_key__isnull=True).count() == 2
