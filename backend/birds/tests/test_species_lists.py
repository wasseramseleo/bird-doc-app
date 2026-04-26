import pytest

from birds.models import SpeciesList

LIST_URL = "/api/birds/species-lists/"


def _detail_url(pk):
    return f"{LIST_URL}{pk}/"


@pytest.mark.django_db
def test_list_returns_only_users_lists(auth_client, user, other_user, species):
    SpeciesList.objects.create(name="Mine", user=user, is_active=False)
    SpeciesList.objects.create(name="Theirs", user=other_user, is_active=False)

    response = auth_client.get(LIST_URL)
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1
    assert body["results"][0]["name"] == "Mine"


@pytest.mark.django_db
def test_create_associates_with_request_user(auth_client, user, species):
    response = auth_client.post(
        LIST_URL,
        {"name": "New", "is_active": False, "species_ids": [str(species.id)]},
        format="json",
    )
    assert response.status_code == 201, response.json()
    sl = SpeciesList.objects.get(name="New")
    assert sl.user_id == user.id
    assert species in sl.species.all()


@pytest.mark.django_db
def test_create_with_active_deactivates_prior_active(auth_client, user, species):
    prior = SpeciesList.objects.create(name="Prior", user=user, is_active=True)

    response = auth_client.post(
        LIST_URL,
        {"name": "New", "is_active": True, "species_ids": [str(species.id)]},
        format="json",
    )
    assert response.status_code == 201, response.json()

    prior.refresh_from_db()
    assert prior.is_active is False
    assert SpeciesList.objects.get(name="New").is_active is True


@pytest.mark.django_db
def test_update_setting_active_deactivates_siblings(auth_client, user, species):
    a = SpeciesList.objects.create(name="A", user=user, is_active=True)
    b = SpeciesList.objects.create(name="B", user=user, is_active=False)
    b.species.add(species)

    response = auth_client.patch(
        _detail_url(b.id),
        {"is_active": True, "species_ids": [str(species.id)]},
        format="json",
    )
    assert response.status_code == 200, response.json()

    a.refresh_from_db()
    b.refresh_from_db()
    assert a.is_active is False
    assert b.is_active is True


@pytest.mark.django_db
def test_user_cannot_access_other_users_list(auth_client, other_user, species):
    other = SpeciesList.objects.create(name="Theirs", user=other_user, is_active=False)
    response = auth_client.get(_detail_url(other.id))
    assert response.status_code == 404


@pytest.mark.django_db
def test_unauthenticated_request_rejected(api_client):
    response = api_client.get(LIST_URL)
    assert response.status_code in (401, 403)
