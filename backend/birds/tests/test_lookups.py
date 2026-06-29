import pytest

from birds.models import Organization, RingingStation


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
def test_organizations_search(auth_client, organization):
    Organization.objects.create(handle="OTHER", name="Different")
    response = auth_client.get("/api/birds/organizations/", {"search": "Test Org"})
    handles = [row["handle"] for row in response.json()["results"]]
    assert handles == [organization.handle]


@pytest.mark.django_db
def test_organizations_cannot_be_created_or_deleted_via_api(auth_client, scientist, organization):
    # The Organisation endpoint exposes edit (Admin-only) but neither create
    # (founding an Organisation is gated by a Zugangscode, a separate slice) nor
    # delete — so even an Admin gets 405 on those verbs. (Station/Organisation
    # *write authorization* is covered in test_authorization.py.)
    create = auth_client.post(
        "/api/birds/organizations/", {"handle": "X", "name": "X"}, format="json"
    )
    delete = auth_client.delete(f"/api/birds/organizations/{organization.handle}/")

    assert create.status_code == 405
    assert delete.status_code == 405
