from datetime import UTC, datetime

import pytest

from birds.models import DataEntry, Ring, Species, SpeciesList

LIST_URL = "/api/birds/species/"


def _use_species(species, scientist, ringing_station, *, project=None, ring_number):
    """Record one capture of ``species`` (optionally in ``project``)."""
    ring = Ring.objects.create(number=ring_number, size=Ring.RingSizes.V)
    return DataEntry.objects.create(
        species=species,
        ring=ring,
        staff=scientist,
        ringing_station=ringing_station,
        project=project,
        date_time=datetime(2026, 1, 1, 12, 0, tzinfo=UTC),
    )


def _order(response):
    return [row["id"] for row in response.json()["results"]]


@pytest.mark.django_db
def test_active_list_still_includes_sentinel_species(auth_client, user, species, sentinel_species):
    """An active list that omits 'Ring Vernichtet' must not hide it."""
    sl = SpeciesList.objects.create(name="Mine", user=user, is_active=True)
    sl.species.add(species)

    ids = {row["id"] for row in auth_client.get(LIST_URL).json()["results"]}
    assert str(sentinel_species.id) in ids
    assert str(species.id) in ids


@pytest.mark.django_db
def test_searching_ring_finds_sentinel(auth_client, sentinel_species):
    response = auth_client.get(LIST_URL, {"search": "Ring"})
    ids = {row["id"] for row in response.json()["results"]}
    assert str(sentinel_species.id) in ids


@pytest.mark.django_db
def test_user_with_no_active_list_sees_all_species(auth_client, species, species_other):
    """No active list -> default queryset includes both fixtures (and the rest)."""
    alpha = auth_client.get(LIST_URL, {"search": "Zzztest"}).json()["results"]
    beta = auth_client.get(LIST_URL, {"search": "Yyytest"}).json()["results"]
    assert {row["id"] for row in alpha} == {str(species.id)}
    assert {row["id"] for row in beta} == {str(species_other.id)}


@pytest.mark.django_db
def test_user_with_active_list_sees_list_species_and_sentinel_only(
    auth_client, user, species, species_other, sentinel_species
):
    sl = SpeciesList.objects.create(name="Mine", user=user, is_active=True)
    sl.species.add(species)

    body = auth_client.get(LIST_URL).json()
    ids = {row["id"] for row in body["results"]}
    # The active list filters out species_other but never the sentinel.
    assert ids == {str(species.id), str(sentinel_species.id)}


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
def test_search_matches_common_name_de_midstring_fragment(auth_client):
    """Typing a fragment that appears mid-name surfaces the species (icontains)."""
    wasseramsel = Species.objects.create(
        common_name_de="Zzztestwasseramsel",
        common_name_en="Zzztest Dipper",
        scientific_name="Zzztestus cinclus",
        family_name="Zzztestidae",
        order_name="Zzztestiformes",
        ring_size=Ring.RingSizes.V,
    )
    response = auth_client.get(LIST_URL, {"search": "amsel"})
    ids = {row["id"] for row in response.json()["results"]}
    assert str(wasseramsel.id) in ids


@pytest.mark.django_db
def test_search_midstring_fragment_finds_sentinel(auth_client, sentinel_species):
    """A fragment inside 'Ring Vernichtet' still surfaces the sentinel."""
    response = auth_client.get(LIST_URL, {"search": "vernichtet"})
    ids = {row["id"] for row in response.json()["results"]}
    assert str(sentinel_species.id) in ids


@pytest.mark.django_db
def test_search_matches_scientific_name(auth_client, species, species_other):
    response = auth_client.get(LIST_URL, {"search": "Yyytestus"})
    ids = {row["id"] for row in response.json()["results"]}
    assert ids == {str(species_other.id)}


@pytest.mark.django_db
def test_results_ordered_by_project_usage_then_alphabetically(
    auth_client, species, species_other, scientist, ringing_station, project
):
    """species_other is used more in the project, so it sorts ahead of species."""
    _use_species(species, scientist, ringing_station, project=project, ring_number="1")
    _use_species(species_other, scientist, ringing_station, project=project, ring_number="2")
    _use_species(species_other, scientist, ringing_station, project=project, ring_number="3")

    order = _order(auth_client.get(LIST_URL, {"project": str(project.id)}))
    assert order.index(str(species_other.id)) < order.index(str(species.id))


@pytest.mark.django_db
def test_empty_project_falls_back_to_global_usage(
    auth_client, species, species_other, scientist, ringing_station, project
):
    """The queried project has no captures, so global usage decides the order."""
    _use_species(species, scientist, ringing_station, ring_number="1")
    _use_species(species_other, scientist, ringing_station, ring_number="2")
    _use_species(species_other, scientist, ringing_station, ring_number="3")

    order = _order(auth_client.get(LIST_URL, {"project": str(project.id)}))
    assert order.index(str(species_other.id)) < order.index(str(species.id))


@pytest.mark.django_db
def test_short_or_empty_search_returns_most_used_first(
    auth_client, species, species_other, scientist, ringing_station, project
):
    """An empty search field surfaces the most-used species at the top."""
    _use_species(species, scientist, ringing_station, project=project, ring_number="1")

    top = _order(auth_client.get(LIST_URL, {"project": str(project.id)}))[0]
    assert top == str(species.id)


@pytest.mark.django_db
def test_active_list_filter_still_limits_which_species_appear(
    auth_client, user, species, species_other, sentinel_species, scientist, ringing_station, project
):
    """Frequency reorders, but the active list still decides membership."""
    # species_other is used more, but it is not on the active list -> stays out.
    _use_species(species_other, scientist, ringing_station, project=project, ring_number="1")
    _use_species(species_other, scientist, ringing_station, project=project, ring_number="2")
    _use_species(species, scientist, ringing_station, project=project, ring_number="3")

    sl = SpeciesList.objects.create(name="Mine", user=user, is_active=True)
    sl.species.add(species)

    ids = set(_order(auth_client.get(LIST_URL, {"project": str(project.id)})))
    assert ids == {str(species.id), str(sentinel_species.id)}


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
