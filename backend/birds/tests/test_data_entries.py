from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import pytest

from birds.models import DataEntry, Project, Ring

LIST_URL = "/api/birds/data-entries/"
VIENNA = ZoneInfo("Europe/Vienna")


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
def test_naive_post_is_interpreted_as_vienna_wall_clock(
    auth_client, species, scientist, ringing_station
):
    # A naive wall-clock time (no offset) is what the Beringer reads off the
    # field clock; it must be anchored to Europe/Vienna. July => CEST (UTC+2).
    payload = _payload(species, scientist, ringing_station, ring_number="600")
    payload["date_time"] = "2026-07-01T08:00:00"

    response = auth_client.post(LIST_URL, payload, format="json")
    assert response.status_code == 201, response.json()

    returned = datetime.fromisoformat(response.json()["date_time"])
    assert returned == datetime(2026, 7, 1, 8, 0, tzinfo=VIENNA)


@pytest.mark.django_db
def test_editing_time_saves_vienna_without_drift(auth_client, species, scientist, ringing_station):
    # Create with a naive wall-clock time, then edit the entry the way the UI
    # does: read it back and re-save. The Vienna wall-clock must not drift.
    create = auth_client.post(
        LIST_URL,
        {
            **_payload(species, scientist, ringing_station, ring_number="610"),
            "date_time": "2026-07-01T08:00:00",
        },
        format="json",
    )
    assert create.status_code == 201, create.json()
    entry_id = create.json()["id"]

    # The detail view renders the stored instant as Vienna localtime.
    fetched = auth_client.get(_detail_url(entry_id)).json()
    assert datetime.fromisoformat(fetched["date_time"]) == datetime(2026, 7, 1, 8, 0, tzinfo=VIENNA)

    # Re-saving the value the client just read back must not shift the instant.
    resave = auth_client.put(
        _detail_url(entry_id),
        {
            **_payload(species, scientist, ringing_station, ring_number="610"),
            "date_time": fetched["date_time"],
        },
        format="json",
    )
    assert resave.status_code == 200, resave.json()
    assert datetime.fromisoformat(resave.json()["date_time"]) == datetime(
        2026, 7, 1, 8, 0, tzinfo=VIENNA
    )


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
def test_new_capture_attaches_to_active_organisation(
    auth_client, species, scientist, ringing_station, organization
):
    """A newly recorded capture attaches to the requester's active Organisation
    (ADR 0005, issue #69)."""
    response = auth_client.post(
        LIST_URL,
        _payload(species, scientist, ringing_station, ring_number="700"),
        format="json",
    )

    assert response.status_code == 201, response.json()
    entry = DataEntry.objects.get(id=response.json()["id"])
    assert entry.organization == organization


@pytest.mark.django_db
def test_create_rejected_when_account_has_no_active_organisation(
    api_client, species, ringing_station
):
    """Without a Mitgliedschaft there is no active Organisation to attach to, so a
    capture cannot be recorded."""
    from django.contrib.auth.models import User

    from birds.models import Scientist

    orphan = User.objects.create_user(username="orphan", password="hunter2-very-strong")
    Scientist.objects.create(user=orphan, handle="ORP")
    api_client.force_authenticate(user=orphan)

    response = api_client.post(
        LIST_URL,
        _payload(species, Scientist.objects.get(handle="ORP"), ringing_station, ring_number="701"),
        format="json",
    )

    assert response.status_code == 403
    assert DataEntry.objects.count() == 0


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
    # bulk_create bypasses Model.save(), so the org fallback never fires — set it
    # explicitly (to the Station's org) to keep these captures in the tenant scope.
    DataEntry.objects.bulk_create(
        DataEntry(
            species=species,
            ring=ring,
            staff=scientist,
            ringing_station=ringing_station,
            organization=ringing_station.organization,
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
def test_list_shows_only_active_organisations_captures(auth_client, data_entry, data_entry_b):
    """The capture list returns only the requester's Organisation's captures."""
    response = auth_client.get(LIST_URL)

    assert response.status_code == 200
    ids = [row["id"] for row in response.json()["results"]]
    assert str(data_entry.id) in ids
    assert str(data_entry_b.id) not in ids


@pytest.mark.django_db
def test_cross_tenant_capture_detail_returns_404(auth_client, data_entry, data_entry_b):
    """A cross-tenant detail fetch is a 404 (the row is invisible), not a 403."""
    response = auth_client.get(_detail_url(data_entry_b.id))

    assert response.status_code == 404


@pytest.mark.django_db
def test_cross_tenant_capture_write_is_rejected(auth_client, data_entry, data_entry_b):
    """A cross-tenant write cannot touch another Organisation's capture."""
    detail = _detail_url(data_entry_b.id)

    patch = auth_client.patch(detail, {"comment": "hacked"}, format="json")
    delete = auth_client.delete(detail)

    assert patch.status_code == 404
    assert delete.status_code == 404
    data_entry_b.refresh_from_db()
    assert data_entry_b.comment != "hacked"
    assert DataEntry.objects.filter(id=data_entry_b.id).exists()


@pytest.mark.django_db
def test_two_tenant_isolation_has_no_leakage_either_direction(
    auth_client, auth_client_b, data_entry, data_entry_b
):
    """Two complete tenants: a Mitglied of A sees only A's captures and a Mitglied
    of B sees only B's — no A↔B leakage (ADR 0005, issue #69)."""
    a_ids = [row["id"] for row in auth_client.get(LIST_URL).json()["results"]]
    b_ids = [row["id"] for row in auth_client_b.get(LIST_URL).json()["results"]]

    assert a_ids == [str(data_entry.id)]
    assert b_ids == [str(data_entry_b.id)]


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
