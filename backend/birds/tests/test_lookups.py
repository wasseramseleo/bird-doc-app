import pytest

from birds.models import Organization, RingingStation


@pytest.mark.django_db
def test_stations_list_shows_only_active_organisations_stations(
    auth_client, membership, ringing_station, ringing_station_b
):
    """Stationen are tenant-scoped: a Mitglied of A sees only A's Stationen, never
    B's (ADR 0005, issue #74)."""
    response = auth_client.get("/api/birds/ringing-stations/")

    assert response.status_code == 200
    handles = [row["handle"] for row in response.json()["results"]]
    assert handles == [ringing_station.handle]
    assert ringing_station_b.handle not in handles


@pytest.mark.django_db
def test_two_tenant_station_isolation_has_no_leakage(
    auth_client, auth_client_b, membership, scientist_b, ringing_station, ringing_station_b
):
    """Two complete tenants: a Mitglied of A sees only A's Stationen and a Mitglied
    of B sees only B's — no A↔B leakage (issue #74)."""
    a = [row["handle"] for row in auth_client.get("/api/birds/ringing-stations/").json()["results"]]
    b = [
        row["handle"] for row in auth_client_b.get("/api/birds/ringing-stations/").json()["results"]
    ]

    assert a == [ringing_station.handle]
    assert b == [ringing_station_b.handle]


@pytest.mark.django_db
def test_cross_tenant_station_detail_returns_404(auth_client, membership, ringing_station_b):
    """A cross-tenant Station detail fetch is a 404 (the row is invisible), not a
    403 (issue #74)."""
    response = auth_client.get(f"/api/birds/ringing-stations/{ringing_station_b.handle}/")

    assert response.status_code == 404


@pytest.mark.django_db
def test_ringing_stations_search(auth_client, membership, ringing_station):
    response = auth_client.get("/api/birds/ringing-stations/", {"search": "Test Station"})
    handles = [row["handle"] for row in response.json()["results"]]
    assert handles == [ringing_station.handle]


@pytest.mark.django_db
def test_ringing_stations_filter_by_organization(
    auth_client, membership, ringing_station, organization
):
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
def test_organizations_list_shows_only_own_memberships(
    auth_client, membership, organization, organization_b
):
    """Organisations are tenant-scoped: the requester sees only the Organisation(s)
    they are a Mitglied of, never another tenant's (ADR 0005, issue #74)."""
    response = auth_client.get("/api/birds/organizations/")

    assert response.status_code == 200
    handles = [row["handle"] for row in response.json()["results"]]
    assert handles == [organization.handle]
    assert organization_b.handle not in handles


@pytest.mark.django_db
def test_cross_tenant_organization_detail_returns_404(auth_client, membership, organization_b):
    """A cross-tenant Organisation detail fetch is a 404 (issue #74)."""
    response = auth_client.get(f"/api/birds/organizations/{organization_b.handle}/")

    assert response.status_code == 404


@pytest.mark.django_db
def test_two_tenant_organization_isolation_has_no_leakage(
    auth_client, auth_client_b, membership, scientist_b, organization, organization_b
):
    """Two complete tenants: each Mitglied sees only their own Organisation — no
    A↔B leakage (issue #74)."""
    a = [row["handle"] for row in auth_client.get("/api/birds/organizations/").json()["results"]]
    b = [row["handle"] for row in auth_client_b.get("/api/birds/organizations/").json()["results"]]

    assert a == [organization.handle]
    assert b == [organization_b.handle]


@pytest.mark.django_db
def test_organizations_search(auth_client, membership, organization):
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
