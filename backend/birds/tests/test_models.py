import importlib
from decimal import Decimal

import pytest
from django.apps import apps as global_apps
from django.core.exceptions import ValidationError

from birds.models import Organization, Project, RingingStation, Scientist, Species, SpeciesList

seed_migration = importlib.import_module(
    "birds.migrations.0034_seed_iwm_station_and_project_context"
)


@pytest.mark.django_db
def test_data_migration_creates_single_ring_vernichtet_sentinel():
    sentinels = Species.objects.filter(is_sentinel=True)

    assert sentinels.count() == 1
    assert sentinels.first().common_name_de == "Ring Vernichtet"


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
