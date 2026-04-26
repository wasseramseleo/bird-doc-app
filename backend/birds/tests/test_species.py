import pytest

from birds.models import SpeciesList

LIST_URL = "/api/birds/species/"


@pytest.mark.django_db
def test_user_with_no_active_list_sees_all_species(auth_client, species, species_other):
    """No active list -> default queryset includes both fixtures (and the rest)."""
    alpha = auth_client.get(LIST_URL, {"search": "Zzztest"}).json()["results"]
    beta = auth_client.get(LIST_URL, {"search": "Yyytest"}).json()["results"]
    assert {row["id"] for row in alpha} == {str(species.id)}
    assert {row["id"] for row in beta} == {str(species_other.id)}


@pytest.mark.django_db
def test_user_with_active_list_sees_only_list_species(auth_client, user, species, species_other):
    sl = SpeciesList.objects.create(name="Mine", user=user, is_active=True)
    sl.species.add(species)

    body = auth_client.get(LIST_URL).json()
    ids = {row["id"] for row in body["results"]}
    assert ids == {str(species.id)}
    assert body["count"] == 1


@pytest.mark.django_db
def test_inactive_lists_do_not_filter_species(auth_client, user, species, species_other):
    sl = SpeciesList.objects.create(name="Mine", user=user, is_active=False)
    sl.species.add(species)

    alpha = auth_client.get(LIST_URL, {"search": "Zzztest"}).json()["results"]
    beta = auth_client.get(LIST_URL, {"search": "Yyytest"}).json()["results"]
    assert {row["id"] for row in alpha} == {str(species.id)}
    assert {row["id"] for row in beta} == {str(species_other.id)}


@pytest.mark.django_db
def test_other_users_active_list_does_not_filter_my_species(
    auth_client, other_user, species, species_other
):
    sl = SpeciesList.objects.create(name="Other", user=other_user, is_active=True)
    sl.species.add(species)

    alpha = auth_client.get(LIST_URL, {"search": "Zzztest"}).json()["results"]
    beta = auth_client.get(LIST_URL, {"search": "Yyytest"}).json()["results"]
    assert {row["id"] for row in alpha} == {str(species.id)}
    assert {row["id"] for row in beta} == {str(species_other.id)}


@pytest.mark.django_db
def test_search_matches_common_name_de_prefix(auth_client, species, species_other):
    response = auth_client.get(LIST_URL, {"search": "Zzztest"})
    ids = {row["id"] for row in response.json()["results"]}
    assert ids == {str(species.id)}


@pytest.mark.django_db
def test_search_matches_scientific_name(auth_client, species, species_other):
    response = auth_client.get(LIST_URL, {"search": "Yyytestus"})
    ids = {row["id"] for row in response.json()["results"]}
    assert ids == {str(species_other.id)}


@pytest.mark.django_db
def test_species_endpoint_is_read_only(auth_client):
    response = auth_client.post(
        LIST_URL,
        {
            "common_name_de": "X",
            "common_name_en": "X",
            "scientific_name": "X x",
        },
        format="json",
    )
    assert response.status_code == 405
