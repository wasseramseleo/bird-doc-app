from datetime import UTC, datetime

import pytest

from birds.models import DataEntry, Project, Ring

LIST_URL = "/api/birds/data-entries/"


def _detail_url(pk):
    return f"{LIST_URL}{pk}/"


def _payload(species, scientist, ringing_station, *, ring_number="200", ring_size="V"):
    return {
        "species_id": str(species.id),
        "staff_id": scientist.id,
        "ringing_station_id": ringing_station.handle,
        "ring_number": ring_number,
        "ring_size": ring_size,
        "date_time": "2026-03-01T12:00:00Z",
    }


@pytest.mark.django_db
def test_list_requires_authentication(api_client):
    response = api_client.get(LIST_URL)
    assert response.status_code in (401, 403)


@pytest.mark.django_db
def test_list_returns_paginated_results(auth_client, data_entry):
    response = auth_client.get(LIST_URL)
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1
    assert "results" in body
    assert body["results"][0]["id"] == str(data_entry.id)


@pytest.mark.django_db
def test_list_orders_by_date_time_desc(auth_client, species, ring, scientist, ringing_station):
    older = DataEntry.objects.create(
        species=species,
        ring=ring,
        staff=scientist,
        ringing_station=ringing_station,
        date_time=datetime(2025, 1, 1, tzinfo=UTC),
    )
    newer_ring = Ring.objects.create(number="201", size=Ring.RingSizes.V)
    newer = DataEntry.objects.create(
        species=species,
        ring=newer_ring,
        staff=scientist,
        ringing_station=ringing_station,
        date_time=datetime(2026, 1, 1, tzinfo=UTC),
    )

    response = auth_client.get(LIST_URL)
    ids = [row["id"] for row in response.json()["results"]]
    assert ids == [str(newer.id), str(older.id)]


@pytest.mark.django_db
def test_create_creates_ring_when_missing(auth_client, species, scientist, ringing_station):
    response = auth_client.post(
        LIST_URL,
        _payload(species, scientist, ringing_station, ring_number="300"),
        format="json",
    )
    assert response.status_code == 201, response.json()
    assert Ring.objects.filter(number="300", size=Ring.RingSizes.V).exists()
    assert DataEntry.objects.count() == 1


@pytest.mark.django_db
def test_create_reuses_existing_ring(auth_client, species, scientist, ringing_station):
    Ring.objects.create(number="400", size=Ring.RingSizes.V)
    response = auth_client.post(
        LIST_URL,
        _payload(species, scientist, ringing_station, ring_number="400"),
        format="json",
    )
    assert response.status_code == 201, response.json()
    assert Ring.objects.filter(number="400", size=Ring.RingSizes.V).count() == 1


@pytest.mark.django_db
def test_create_aves_ignota_without_comment_returns_400(
    auth_client, aves_ignota_species, scientist, ringing_station
):
    """POST for Aves ignota with a blank Bemerkung is rejected (serializer layer)."""
    response = auth_client.post(
        LIST_URL,
        _payload(aves_ignota_species, scientist, ringing_station, ring_number="660"),
        format="json",
    )
    assert response.status_code == 400
    assert "comment" in response.json()
    assert DataEntry.objects.count() == 0


@pytest.mark.django_db
def test_create_aves_ignota_with_comment_succeeds(
    auth_client, aves_ignota_species, scientist, ringing_station
):
    payload = _payload(aves_ignota_species, scientist, ringing_station, ring_number="661")
    payload["comment"] = "Irrgast, nicht auf der Artenliste."

    response = auth_client.post(LIST_URL, payload, format="json")

    assert response.status_code == 201, response.json()
    assert DataEntry.objects.count() == 1
    assert DataEntry.objects.get().comment == "Irrgast, nicht auf der Artenliste."


@pytest.mark.django_db
def test_create_ring_destroyed_nulls_bird_data_server_side(
    auth_client, sentinel_species, scientist, ringing_station
):
    """A 'Ring Vernichtet' capture files no bird data — every bird-data field is
    nulled server-side regardless of what the client sent (no regression)."""
    payload = _payload(sentinel_species, scientist, ringing_station, ring_number="662")
    payload.update(
        {
            "age_class": DataEntry.AgeClass.THIS_YEAR,
            "sex": DataEntry.Sex.MALE,
            "bird_status": DataEntry.BirdStatus.FIRST_CATCH,
            "wing_span": "73.0",
            "weight_gram": "18.0",
        }
    )

    response = auth_client.post(LIST_URL, payload, format="json")

    assert response.status_code == 201, response.json()
    entry = DataEntry.objects.get()
    assert entry.age_class is None
    assert entry.sex is None
    assert entry.bird_status is None
    assert entry.wing_span is None
    assert entry.weight_gram is None
    assert entry.ring.number == "662"


@pytest.mark.django_db
def test_update_switches_ring_and_cleans_orphan(
    auth_client, data_entry, species, scientist, ringing_station
):
    old_ring_id = data_entry.ring_id

    response = auth_client.put(
        _detail_url(data_entry.id),
        _payload(species, scientist, ringing_station, ring_number="555"),
        format="json",
    )
    assert response.status_code == 200, response.json()
    assert not Ring.objects.filter(id=old_ring_id).exists()
    assert Ring.objects.filter(number="555", size=Ring.RingSizes.V).exists()


@pytest.mark.django_db
def test_filter_by_project_returns_only_that_projects_entries(
    auth_client, species, ring, scientist, ringing_station, project, organization
):
    other_project = Project.objects.create(title="Other Project", organization=organization)
    other_project.scientists.add(scientist)

    mine = DataEntry.objects.create(
        species=species,
        ring=ring,
        staff=scientist,
        ringing_station=ringing_station,
        project=project,
        date_time=datetime(2026, 1, 1, tzinfo=UTC),
    )
    other_ring = Ring.objects.create(number="900", size=Ring.RingSizes.V)
    DataEntry.objects.create(
        species=species,
        ring=other_ring,
        staff=scientist,
        ringing_station=ringing_station,
        project=other_project,
        date_time=datetime(2026, 1, 2, tzinfo=UTC),
    )

    response = auth_client.get(LIST_URL, {"project": str(project.id)})
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1
    assert body["results"][0]["id"] == str(mine.id)


def _bulk_entries(n, *, species, ring, scientist, ringing_station, project=None):
    DataEntry.objects.bulk_create(
        DataEntry(
            species=species,
            ring=ring,
            staff=scientist,
            ringing_station=ringing_station,
            project=project,
            date_time=datetime(2026, 1, 1, tzinfo=UTC),
        )
        for _ in range(n)
    )


@pytest.mark.django_db
def test_page_size_query_param_is_honoured(auth_client, species, ring, scientist, ringing_station):
    _bulk_entries(
        12, species=species, ring=ring, scientist=scientist, ringing_station=ringing_station
    )

    response = auth_client.get(LIST_URL, {"page_size": 50})
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 12
    assert len(body["results"]) == 12


@pytest.mark.django_db
def test_search_filters_by_species_name_partial_match(
    auth_client, species, species_other, ring, scientist, ringing_station
):
    target = DataEntry.objects.create(
        species=species,
        ring=ring,
        staff=scientist,
        ringing_station=ringing_station,
        date_time=datetime(2026, 1, 1, tzinfo=UTC),
    )
    other_ring = Ring.objects.create(number="901", size=Ring.RingSizes.V)
    DataEntry.objects.create(
        species=species_other,
        ring=other_ring,
        staff=scientist,
        ringing_station=ringing_station,
        date_time=datetime(2026, 1, 2, tzinfo=UTC),
    )

    response = auth_client.get(LIST_URL, {"search": "Zzztestus al"})
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1
    assert body["results"][0]["id"] == str(target.id)


@pytest.mark.django_db
def test_project_list_ordered_by_created_desc(
    auth_client, species, scientist, ringing_station, project
):
    # date_time order is the inverse of created order, so the two orderings disagree.
    newer_date = DataEntry.objects.create(
        species=species,
        ring=Ring.objects.create(number="910", size=Ring.RingSizes.V),
        staff=scientist,
        ringing_station=ringing_station,
        project=project,
        date_time=datetime(2026, 6, 1, tzinfo=UTC),
    )
    older_date = DataEntry.objects.create(
        species=species,
        ring=Ring.objects.create(number="911", size=Ring.RingSizes.V),
        staff=scientist,
        ringing_station=ringing_station,
        project=project,
        date_time=datetime(2026, 1, 1, tzinfo=UTC),
    )
    DataEntry.objects.filter(id=newer_date.id).update(created=datetime(2026, 1, 1, tzinfo=UTC))
    DataEntry.objects.filter(id=older_date.id).update(created=datetime(2026, 6, 1, tzinfo=UTC))

    response = auth_client.get(LIST_URL, {"project": str(project.id)})
    ids = [row["id"] for row in response.json()["results"]]
    assert ids == [str(older_date.id), str(newer_date.id)]


@pytest.mark.django_db
def test_page_size_above_max_clamps_to_100(auth_client, species, ring, scientist, ringing_station):
    _bulk_entries(
        101, species=species, ring=ring, scientist=scientist, ringing_station=ringing_station
    )

    response = auth_client.get(LIST_URL, {"page_size": 200})
    body = response.json()
    assert body["count"] == 101
    assert len(body["results"]) == 100


@pytest.mark.django_db
def test_page_size_absent_defaults_to_10(auth_client, species, ring, scientist, ringing_station):
    _bulk_entries(
        12, species=species, ring=ring, scientist=scientist, ringing_station=ringing_station
    )

    response = auth_client.get(LIST_URL)
    body = response.json()
    assert body["count"] == 12
    assert len(body["results"]) == 10


@pytest.mark.django_db
def test_delete_removes_entry(auth_client, data_entry):
    response = auth_client.delete(_detail_url(data_entry.id))
    assert response.status_code == 204
    assert not DataEntry.objects.filter(id=data_entry.id).exists()


@pytest.mark.django_db
def test_filter_by_ring_size_and_number(auth_client, species, scientist, ringing_station):
    target_ring = Ring.objects.create(number="123", size=Ring.RingSizes.V)
    other_ring = Ring.objects.create(number="124", size=Ring.RingSizes.V)

    target = DataEntry.objects.create(
        species=species,
        ring=target_ring,
        staff=scientist,
        ringing_station=ringing_station,
        date_time=datetime(2026, 1, 1, tzinfo=UTC),
    )
    DataEntry.objects.create(
        species=species,
        ring=other_ring,
        staff=scientist,
        ringing_station=ringing_station,
        date_time=datetime(2026, 1, 2, tzinfo=UTC),
    )

    response = auth_client.get(LIST_URL, {"ring_size": "V", "ring_number": "123"})
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1
    assert body["results"][0]["id"] == str(target.id)
