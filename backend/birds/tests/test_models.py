import pytest

from birds.models import Scientist, Species, SpeciesList


@pytest.mark.django_db
def test_data_migration_creates_single_ring_vernichtet_sentinel():
    sentinels = Species.objects.filter(is_sentinel=True)

    assert sentinels.count() == 1
    assert sentinels.first().common_name_de == "Ring Vernichtet"


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
def test_saving_inactive_list_does_not_deactivate_siblings(user):
    active = SpeciesList.objects.create(name="A", user=user, is_active=True)
    SpeciesList.objects.create(name="B", user=user, is_active=False)

    active.refresh_from_db()
    assert active.is_active is True
