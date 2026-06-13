import pytest

from birds.models import Organization, Project, RingingStation

LIST_URL = "/api/birds/projects/"


@pytest.mark.django_db
def test_user_without_scientist_gets_empty_queryset(auth_client, organization):
    Project.objects.create(title="Hidden", organization=organization)
    response = auth_client.get(LIST_URL)
    assert response.status_code == 200
    assert response.json()["count"] == 0


@pytest.mark.django_db
def test_scientist_sees_only_projects_they_belong_to(
    auth_client, scientist, organization, other_scientist
):
    mine = Project.objects.create(title="Mine", organization=organization)
    mine.scientists.add(scientist)
    theirs = Project.objects.create(title="Theirs", organization=organization)
    theirs.scientists.add(other_scientist)

    response = auth_client.get(LIST_URL)
    titles = [row["title"] for row in response.json()["results"]]
    assert titles == ["Mine"]


@pytest.mark.django_db
def test_create_auto_adds_creator_scientist(auth_client, scientist, organization):
    response = auth_client.post(
        LIST_URL,
        {"title": "P", "description": "", "organization_id": organization.handle},
        format="json",
    )
    assert response.status_code == 201, response.json()
    project = Project.objects.get(title="P")
    assert scientist in project.scientists.all()


@pytest.mark.django_db
def test_create_does_not_duplicate_creator_when_in_scientist_ids(
    auth_client, scientist, organization, other_scientist
):
    response = auth_client.post(
        LIST_URL,
        {
            "title": "P",
            "description": "",
            "organization_id": organization.handle,
            "scientist_ids": [scientist.id, other_scientist.id],
        },
        format="json",
    )
    assert response.status_code == 201, response.json()
    project = Project.objects.get(title="P")
    assert project.scientists.count() == 2


@pytest.mark.django_db
def test_create_project_with_default_station_round_trips(
    auth_client, scientist, organization, ringing_station
):
    response = auth_client.post(
        LIST_URL,
        {
            "title": "P",
            "organization_id": organization.handle,
            "default_station_id": ringing_station.handle,
        },
        format="json",
    )
    assert response.status_code == 201, response.json()
    assert response.json()["default_station"]["handle"] == ringing_station.handle
    project = Project.objects.get(title="P")
    assert project.default_station == ringing_station


@pytest.mark.django_db
def test_default_station_from_other_organization_is_rejected(auth_client, scientist, organization):
    other_org = Organization.objects.create(handle="ORG2", name="Other Org")
    foreign_station = RingingStation.objects.create(
        handle="STN2", name="Foreign", organization=other_org
    )
    response = auth_client.post(
        LIST_URL,
        {
            "title": "P",
            "organization_id": organization.handle,
            "default_station_id": foreign_station.handle,
        },
        format="json",
    )
    assert response.status_code == 400
    assert "default_station_id" in response.json()


@pytest.mark.django_db
def test_set_and_clear_default_station_on_update(auth_client, project, ringing_station):
    url = f"{LIST_URL}{project.id}/"

    set_response = auth_client.patch(
        url, {"default_station_id": ringing_station.handle}, format="json"
    )
    assert set_response.status_code == 200, set_response.json()
    project.refresh_from_db()
    assert project.default_station == ringing_station

    clear_response = auth_client.patch(url, {"default_station_id": None}, format="json")
    assert clear_response.status_code == 200, clear_response.json()
    project.refresh_from_db()
    assert project.default_station is None


@pytest.mark.django_db
def test_update_rejects_default_station_from_other_organization(auth_client, project):
    other_org = Organization.objects.create(handle="ORG2", name="Other Org")
    foreign_station = RingingStation.objects.create(
        handle="STN2", name="Foreign", organization=other_org
    )
    response = auth_client.patch(
        f"{LIST_URL}{project.id}/",
        {"default_station_id": foreign_station.handle},
        format="json",
    )
    assert response.status_code == 400
    assert "default_station_id" in response.json()
