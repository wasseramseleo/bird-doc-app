import pytest

from birds.models import Project

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
