from datetime import UTC, datetime

import pytest

from birds.models import DataEntry, Ring

NEXT_NUMBER_URL = "/api/birds/rings/next-number/"
LIST_URL = "/api/birds/rings/"


def _catch(
    *,
    number,
    species,
    scientist,
    ringing_station,
    size=Ring.RingSizes.V,
    status=DataEntry.BirdStatus.FIRST_CATCH,
    project=None,
):
    """Seed a Ring of the given size and a DataEntry capturing it with `status`."""
    ring = Ring.objects.create(number=number, size=size)
    DataEntry.objects.create(
        species=species,
        ring=ring,
        staff=scientist,
        ringing_station=ringing_station,
        project=project,
        bird_status=status,
        date_time=datetime(2026, 1, 1, 12, 0, tzinfo=UTC),
    )
    return ring


@pytest.mark.django_db
def test_next_number_requires_size_param(auth_client):
    response = auth_client.get(NEXT_NUMBER_URL)
    assert response.status_code == 400
    assert "error" in response.json()


@pytest.mark.django_db
def test_next_number_with_no_rings_returns_one(auth_client):
    response = auth_client.get(NEXT_NUMBER_URL, {"size": "V"})
    assert response.status_code == 200
    assert response.json() == {"next_number": 1}


@pytest.mark.django_db
def test_next_number_returns_max_plus_one(auth_client, species, scientist, ringing_station):
    for number in ("9", "10", "2"):
        _catch(
            number=number,
            species=species,
            scientist=scientist,
            ringing_station=ringing_station,
        )

    response = auth_client.get(NEXT_NUMBER_URL, {"size": "V"})
    assert response.status_code == 200
    assert response.json() == {"next_number": 11}


@pytest.mark.django_db
def test_next_number_isolated_per_size(auth_client, species, scientist, ringing_station):
    _catch(
        number="50",
        size=Ring.RingSizes.V,
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
    )
    _catch(
        number="5",
        size=Ring.RingSizes.T,
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
    )

    response = auth_client.get(NEXT_NUMBER_URL, {"size": "T"})
    assert response.json() == {"next_number": 6}


@pytest.mark.django_db
def test_next_number_falls_back_to_one_for_non_numeric(auth_client):
    Ring.objects.create(number="ABC", size=Ring.RingSizes.V)

    response = auth_client.get(NEXT_NUMBER_URL, {"size": "V"})
    assert response.json() == {"next_number": 1}


@pytest.mark.django_db
def test_next_number_is_scoped_to_project_first_catches(
    auth_client, species, scientist, ringing_station, project, organization
):
    from birds.models import Project

    other_project = Project.objects.create(title="Other", organization=organization)

    # First-catch rings inside the selected project.
    _catch(
        number="41",
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        project=project,
    )
    # A higher first-catch ring belonging to a *different* project must be ignored.
    _catch(
        number="99",
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        project=other_project,
    )

    response = auth_client.get(NEXT_NUMBER_URL, {"size": "V", "project": str(project.id)})
    assert response.status_code == 200
    assert response.json() == {"next_number": 42}


@pytest.mark.django_db
def test_next_number_falls_back_to_global_first_catch_for_empty_project(
    auth_client, species, scientist, ringing_station, project, organization
):
    from birds.models import Project

    other_project = Project.objects.create(title="Other", organization=organization)
    # A global first-catch exists, but none in the selected project.
    _catch(
        number="70",
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        project=other_project,
    )

    response = auth_client.get(NEXT_NUMBER_URL, {"size": "V", "project": str(project.id)})
    assert response.status_code == 200
    assert response.json() == {"next_number": 71}


@pytest.mark.django_db
def test_next_number_returns_one_when_no_first_catch_anywhere(
    auth_client, species, scientist, ringing_station, project
):
    # Only a recapture (Wiederfang) exists — no first-catch ring of this size.
    _catch(
        number="500",
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        status=DataEntry.BirdStatus.RE_CATCH,
        project=project,
    )

    response = auth_client.get(NEXT_NUMBER_URL, {"size": "V", "project": str(project.id)})
    assert response.status_code == 200
    assert response.json() == {"next_number": 1}


@pytest.mark.django_db
def test_recapture_of_foreign_ring_does_not_raise_suggestion(
    auth_client, species, scientist, ringing_station, project
):
    # A genuine first-catch in the project...
    _catch(
        number="42",
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        project=project,
    )
    # ...and a recapture of a high-numbered foreign mark, which must be ignored.
    _catch(
        number="900000",
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        status=DataEntry.BirdStatus.RE_CATCH,
        project=project,
    )

    response = auth_client.get(NEXT_NUMBER_URL, {"size": "V", "project": str(project.id)})
    assert response.status_code == 200
    assert response.json() == {"next_number": 43}


@pytest.mark.django_db
def test_rings_endpoint_is_read_only(auth_client):
    response = auth_client.post(LIST_URL, {"number": "1", "size": "V"}, format="json")
    assert response.status_code == 405
