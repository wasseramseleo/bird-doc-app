import pytest

from birds.models import Organization, RingingStation, Scientist


@pytest.mark.django_db
def test_scientists_search_by_handle(auth_client, scientist, other_scientist):
    response = auth_client.get("/api/birds/scientists/", {"search": "ALC"})
    handles = [row["handle"] for row in response.json()["results"]]
    assert handles == ["ALC"]


@pytest.mark.django_db
def test_scientists_search_by_user_name(auth_client, user, other_user):
    user.first_name = "Alice"
    user.last_name = "Adams"
    user.save()
    Scientist.objects.create(user=user, handle="AAA")
    Scientist.objects.create(user=other_user, handle="BBB")

    response = auth_client.get("/api/birds/scientists/", {"search": "Adams"})
    handles = [row["handle"] for row in response.json()["results"]]
    assert handles == ["AAA"]


@pytest.mark.django_db
def test_scientists_endpoint_is_read_only(auth_client):
    response = auth_client.post("/api/birds/scientists/", {"handle": "X"}, format="json")
    assert response.status_code == 405


@pytest.mark.django_db
def test_ringing_stations_search(auth_client, ringing_station):
    response = auth_client.get("/api/birds/ringing-stations/", {"search": "Test Station"})
    handles = [row["handle"] for row in response.json()["results"]]
    assert handles == [ringing_station.handle]


@pytest.mark.django_db
def test_ringing_stations_filter_by_organization(auth_client, ringing_station, organization):
    other_org = Organization.objects.create(handle="ORG2", name="Other Org")
    RingingStation.objects.create(handle="STN2", name="Other Station", organization=other_org)

    response = auth_client.get(
        "/api/birds/ringing-stations/", {"organization": organization.handle}
    )
    handles = [row["handle"] for row in response.json()["results"]]
    assert handles == [ringing_station.handle]


@pytest.mark.django_db
def test_ringing_stations_endpoint_is_read_only(auth_client, organization):
    response = auth_client.post(
        "/api/birds/ringing-stations/",
        {"handle": "X", "name": "X", "organization_id": organization.handle},
        format="json",
    )
    assert response.status_code == 405


@pytest.mark.django_db
def test_organizations_search(auth_client, organization):
    Organization.objects.create(handle="OTHER", name="Different")
    response = auth_client.get("/api/birds/organizations/", {"search": "Test Org"})
    handles = [row["handle"] for row in response.json()["results"]]
    assert handles == [organization.handle]


@pytest.mark.django_db
def test_organizations_endpoint_is_read_only(auth_client):
    response = auth_client.post(
        "/api/birds/organizations/", {"handle": "X", "name": "X"}, format="json"
    )
    assert response.status_code == 405
