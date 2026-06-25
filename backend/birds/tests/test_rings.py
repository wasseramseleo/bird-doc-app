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
    created=None,
):
    """Seed a Ring of the given size and a DataEntry capturing it with `status`.

    `created` overrides the record's creation timestamp (which is otherwise
    `auto_now_add`), letting a test pin down which entry is the *most recent*
    consumption of the rope independently of the order rows are inserted.
    """
    ring = Ring.objects.create(number=number, size=size)
    entry = DataEntry.objects.create(
        species=species,
        ring=ring,
        staff=scientist,
        ringing_station=ringing_station,
        project=project,
        bird_status=status,
        date_time=datetime(2026, 1, 1, 12, 0, tzinfo=UTC),
    )
    if created is not None:
        DataEntry.objects.filter(pk=entry.pk).update(created=created)
    return ring


def _at(day):
    return datetime(2026, 1, day, 12, 0, tzinfo=UTC)


@pytest.mark.django_db
def test_next_number_requires_size_param(auth_client):
    response = auth_client.get(NEXT_NUMBER_URL)
    assert response.status_code == 400
    assert "error" in response.json()


@pytest.mark.django_db
def test_next_number_with_no_rings_returns_null(auth_client, project):
    response = auth_client.get(NEXT_NUMBER_URL, {"size": "V", "project": str(project.id)})
    assert response.status_code == 200
    assert response.json() == {"next_number": None}


@pytest.mark.django_db
def test_next_number_follows_last_consumed_not_max(
    auth_client, species, scientist, ringing_station, project
):
    # A higher number was consumed earlier; a lower number is the most recent
    # draw from the rope. The suggestion follows the latter (+1), not the max.
    _catch(
        number="0050",
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        project=project,
        created=_at(1),
    )
    _catch(
        number="0042",
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        project=project,
        created=_at(2),
    )

    response = auth_client.get(NEXT_NUMBER_URL, {"size": "V", "project": str(project.id)})
    assert response.status_code == 200
    assert response.json() == {"next_number": "0043"}


@pytest.mark.django_db
def test_next_number_preserves_leading_zero_width(
    auth_client, species, scientist, ringing_station, project
):
    _catch(
        number="0042",
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        project=project,
    )

    response = auth_client.get(NEXT_NUMBER_URL, {"size": "V", "project": str(project.id)})
    assert response.json() == {"next_number": "0043"}


@pytest.mark.django_db
def test_sentinel_entry_advances_the_number(
    auth_client, sentinel_species, scientist, ringing_station, project
):
    # A destroyed ring is recorded against the sentinel species; its number was
    # drawn from the rope, so the next suggestion follows it.
    _catch(
        number="0007",
        species=sentinel_species,
        scientist=scientist,
        ringing_station=ringing_station,
        project=project,
    )

    response = auth_client.get(NEXT_NUMBER_URL, {"size": "V", "project": str(project.id)})
    assert response.json() == {"next_number": "0008"}


@pytest.mark.django_db
def test_recapture_does_not_advance_the_number(
    auth_client, species, scientist, ringing_station, project
):
    # A genuine first catch consumes a number...
    _catch(
        number="0042",
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        project=project,
        created=_at(1),
    )
    # ...and a later recapture of a high foreign mark consumes nothing.
    _catch(
        number="900000",
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        status=DataEntry.BirdStatus.RE_CATCH,
        project=project,
        created=_at(2),
    )

    response = auth_client.get(NEXT_NUMBER_URL, {"size": "V", "project": str(project.id)})
    assert response.json() == {"next_number": "0043"}


@pytest.mark.django_db
def test_recording_beringer_is_irrelevant(
    auth_client, species, scientist, other_scientist, ringing_station, project
):
    # The most recent consumption was recorded by a different Beringer; it still
    # drives the suggestion.
    _catch(
        number="0042",
        species=species,
        scientist=other_scientist,
        ringing_station=ringing_station,
        project=project,
    )

    response = auth_client.get(NEXT_NUMBER_URL, {"size": "V", "project": str(project.id)})
    assert response.json() == {"next_number": "0043"}


@pytest.mark.django_db
def test_next_number_isolated_per_size(auth_client, species, scientist, ringing_station, project):
    _catch(
        number="0050",
        size=Ring.RingSizes.V,
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        project=project,
    )
    _catch(
        number="0005",
        size=Ring.RingSizes.T,
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        project=project,
    )

    response = auth_client.get(NEXT_NUMBER_URL, {"size": "T", "project": str(project.id)})
    assert response.json() == {"next_number": "0006"}


@pytest.mark.django_db
def test_first_entry_of_a_size_returns_null(
    auth_client, species, scientist, ringing_station, project
):
    # Only a recapture exists — no number has been drawn from the rope yet.
    _catch(
        number="0500",
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        status=DataEntry.BirdStatus.RE_CATCH,
        project=project,
    )

    response = auth_client.get(NEXT_NUMBER_URL, {"size": "V", "project": str(project.id)})
    assert response.status_code == 200
    assert response.json() == {"next_number": None}


@pytest.mark.django_db
def test_non_numeric_previous_number_returns_null(
    auth_client, species, scientist, ringing_station, project
):
    _catch(
        number="ABC",
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        project=project,
    )

    response = auth_client.get(NEXT_NUMBER_URL, {"size": "V", "project": str(project.id)})
    assert response.status_code == 200
    assert response.json() == {"next_number": None}


@pytest.mark.django_db
def test_other_project_consumption_is_ignored(
    auth_client, species, scientist, ringing_station, project, organization
):
    from birds.models import Project

    other_project = Project.objects.create(title="Other", organization=organization)
    # A consumption in a different project must not bleed into this one.
    _catch(
        number="0099",
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        project=other_project,
    )

    response = auth_client.get(NEXT_NUMBER_URL, {"size": "V", "project": str(project.id)})
    assert response.status_code == 200
    assert response.json() == {"next_number": None}


@pytest.mark.django_db
def test_rings_endpoint_is_read_only(auth_client):
    response = auth_client.post(LIST_URL, {"number": "1", "size": "V"}, format="json")
    assert response.status_code == 405
