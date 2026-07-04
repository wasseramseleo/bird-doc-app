import uuid
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
def test_server_never_enforces_plausibility_out_of_range_weight_persists(
    auth_client, species, scientist, ringing_station, organization
):
    """Plausibility is a purely client-side concern (PRD #245, ADR 0021): the
    server runs no Ausreißertest and never blocks. A capture with a wildly
    out-of-range Gewicht persists with the value it was sent — even when a
    global-default Artennorm exists for the species."""
    from decimal import Decimal

    from birds.models import SpeciesNorm

    SpeciesNorm.objects.create(
        species=species, organization=None, weight_mean=Decimal("9.1"), weight_sd=Decimal("0.82")
    )
    payload = _payload(species, scientist, ringing_station, ring_number="777")
    payload["weight_gram"] = "250.0"  # ~30 SD outside the band

    response = auth_client.post(LIST_URL, payload, format="json")

    assert response.status_code == 201, response.json()
    entry = DataEntry.objects.get(id=response.json()["id"])
    assert entry.weight_gram == Decimal("250.0")


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
def test_create_reuses_existing_ring(
    auth_client, species, scientist, ringing_station, organization
):
    # Reuse is scoped to the recording Organisation (ADR 0006): a ring already
    # owned by that org is reused rather than duplicated.
    Ring.objects.create(number="400", size=Ring.RingSizes.V, organization=organization)
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
    # These share one Ring purely to fill a page; at most one Erstfang may
    # reference a ring (unique_erstfang_per_ring, issue #164), so they are recorded
    # as Wiederfänge — a recapture consumes no rope number and any number may share
    # the ring, exactly what a pagination fixture needs.
    DataEntry.objects.bulk_create(
        DataEntry(
            species=species,
            ring=ring,
            staff=scientist,
            ringing_station=ringing_station,
            organization=ringing_station.organization,
            project=project,
            bird_status=DataEntry.BirdStatus.RE_CATCH,
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
def test_search_filters_by_ring_number_partial_match(
    auth_client, species, species_other, ring, scientist, ringing_station
):
    target_ring = Ring.objects.create(number="778899", size=Ring.RingSizes.V)
    target = DataEntry.objects.create(
        species=species,
        ring=target_ring,
        staff=scientist,
        ringing_station=ringing_station,
        date_time=datetime(2026, 1, 1, tzinfo=UTC),
    )
    other_ring = Ring.objects.create(number="112233", size=Ring.RingSizes.V)
    DataEntry.objects.create(
        species=species_other,
        ring=other_ring,
        staff=scientist,
        ringing_station=ringing_station,
        date_time=datetime(2026, 1, 2, tzinfo=UTC),
    )

    response = auth_client.get(LIST_URL, {"search": "7788"})
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
def test_replaying_create_with_known_idempotency_key_returns_existing_no_duplicate(
    auth_client, species, scientist, ringing_station
):
    """#155: an offline outbox retry replays the exact same create twice — the
    second POST must return the first capture, not mint a duplicate."""
    payload = _payload(species, scientist, ringing_station, ring_number="750")
    payload["idempotency_key"] = "11111111-1111-1111-1111-111111111111"

    first = auth_client.post(LIST_URL, payload, format="json")
    assert first.status_code == 201, first.json()

    replay = auth_client.post(LIST_URL, payload, format="json")
    assert replay.status_code == 201, replay.json()

    assert replay.json()["id"] == first.json()["id"]
    assert DataEntry.objects.count() == 1


@pytest.mark.django_db
def test_replay_does_not_mint_a_second_ring(auth_client, species, scientist, ringing_station):
    """#155: Ring get-or-create (ADR 0006) is unchanged under replay — the
    short-circuit returns before ever touching Ring, so no second/orphaned
    Ring is created for the same (size, number)."""
    payload = _payload(species, scientist, ringing_station, ring_number="751")
    payload["idempotency_key"] = "22222222-2222-2222-2222-222222222222"

    auth_client.post(LIST_URL, payload, format="json")
    auth_client.post(LIST_URL, payload, format="json")

    assert Ring.objects.filter(number="751", size=Ring.RingSizes.V).count() == 1


@pytest.mark.django_db
def test_create_with_different_idempotency_keys_creates_two_records(
    auth_client, species, scientist, ringing_station
):
    """A different key is simply a different capture — creates as today."""
    first_payload = _payload(species, scientist, ringing_station, ring_number="752")
    first_payload["idempotency_key"] = "33333333-3333-3333-3333-333333333333"
    second_payload = _payload(species, scientist, ringing_station, ring_number="753")
    second_payload["idempotency_key"] = "44444444-4444-4444-4444-444444444444"

    first = auth_client.post(LIST_URL, first_payload, format="json")
    second = auth_client.post(LIST_URL, second_payload, format="json")

    assert first.status_code == 201, first.json()
    assert second.status_code == 201, second.json()
    assert first.json()["id"] != second.json()["id"]
    assert DataEntry.objects.count() == 2


@pytest.mark.django_db
def test_create_without_idempotency_key_behaves_as_today(
    auth_client, species, scientist, ringing_station
):
    """A create with no key at all is unaffected — same as before this feature."""
    payload = _payload(species, scientist, ringing_station, ring_number="754")

    response = auth_client.post(LIST_URL, payload, format="json")

    assert response.status_code == 201, response.json()
    entry = DataEntry.objects.get()
    assert entry.idempotency_key is None


@pytest.mark.django_db
def test_two_creates_without_idempotency_key_both_succeed(
    auth_client, species, scientist, ringing_station
):
    """Multiple key-less creates never collide with one another (NULL != NULL)."""
    first = auth_client.post(
        LIST_URL, _payload(species, scientist, ringing_station, ring_number="755"), format="json"
    )
    second = auth_client.post(
        LIST_URL, _payload(species, scientist, ringing_station, ring_number="756"), format="json"
    )

    assert first.status_code == 201, first.json()
    assert second.status_code == 201, second.json()
    assert DataEntry.objects.count() == 2


@pytest.mark.django_db
def test_update_does_not_change_idempotency_key(auth_client, species, scientist, ringing_station):
    """Editing an existing capture must never change its idempotency key, even
    if the write payload carries a different one."""
    payload = _payload(species, scientist, ringing_station, ring_number="757")
    payload["idempotency_key"] = "55555555-5555-5555-5555-555555555555"
    create = auth_client.post(LIST_URL, payload, format="json")
    assert create.status_code == 201, create.json()
    entry_id = create.json()["id"]

    update_payload = _payload(species, scientist, ringing_station, ring_number="757")
    update_payload["idempotency_key"] = "66666666-6666-6666-6666-666666666666"
    response = auth_client.put(_detail_url(entry_id), update_payload, format="json")

    assert response.status_code == 200, response.json()
    entry = DataEntry.objects.get(id=entry_id)
    assert str(entry.idempotency_key) == "55555555-5555-5555-5555-555555555555"


@pytest.mark.django_db
def test_idempotency_replay_is_scoped_to_the_recording_organisation(
    auth_client, auth_client_b, species, scientist, ringing_station, scientist_b, ringing_station_b
):
    """A key that happens to collide across two tenants (freak accident or a
    malicious probe) must never hand tenant A's capture back to tenant B — the
    replay match is scoped to the recording Organisation (ADR 0005)."""
    shared_key = "77777777-7777-7777-7777-777777777777"
    payload_a = _payload(species, scientist, ringing_station, ring_number="758")
    payload_a["idempotency_key"] = shared_key

    created = auth_client.post(LIST_URL, payload_a, format="json")
    assert created.status_code == 201, created.json()

    payload_b = _payload(species, scientist_b, ringing_station_b, ring_number="759")
    payload_b["idempotency_key"] = shared_key

    response_b = auth_client_b.post(LIST_URL, payload_b, format="json")

    # Tenant B's own, independent capture is created — never tenant A's record.
    assert response_b.status_code == 201, response_b.json()
    assert response_b.json()["id"] != created.json()["id"]
    assert DataEntry.objects.count() == 2


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


@pytest.mark.django_db
def test_duplicate_erstfang_across_devices_is_rejected_not_silently_duplicated(
    auth_client, species, scientist, ringing_station
):
    """AC3 (#164): two offline devices at one Organisation each record an
    Erstfang on the same ring number (each with its own idempotency key). The
    first wins; the second is a genuine ring-uniqueness collision (ADR 0006)
    and is refused with a 400 field error, so the losing device surfaces
    exactly one flagged sync error rather than silently filing a second
    Erstfang on one physical ring."""
    first = auth_client.post(
        LIST_URL,
        {
            **_payload(species, scientist, ringing_station, ring_number="820"),
            "idempotency_key": str(uuid.uuid4()),
        },
        format="json",
    )
    assert first.status_code == 201, first.json()

    second = auth_client.post(
        LIST_URL,
        {
            **_payload(species, scientist, ringing_station, ring_number="820"),
            "idempotency_key": str(uuid.uuid4()),
        },
        format="json",
    )
    assert second.status_code == 400, second.json()
    assert "ring_number" in second.json()
    assert (
        DataEntry.objects.filter(
            ring__number="820", bird_status=DataEntry.BirdStatus.FIRST_CATCH
        ).count()
        == 1
    )


# --- Zentrale write path (ADR 0019, issue #229) ------------------------------
# The capture WRITE payload carries the central flat (EURING scheme_code string)
# alongside ring_size/ring_number; GET keeps returning it nested inside the Ring.


@pytest.mark.django_db
def test_foreign_wiederfang_creates_ring_under_zentrale_and_get_returns_it_nested(
    auth_client, species, scientist, ringing_station
):
    """A Wiederfang carrying a known foreign scheme code creates a Ring under
    that Zentrale with a free-text Größe and an alphanumeric Nummer; the GET
    detail returns the Zentrale nested inside the Ring (US 1, 6, 7)."""
    payload = {
        **_payload(species, scientist, ringing_station, ring_number="SK99A", ring_size="6.0"),
        "central": "SKB",
        "bird_status": DataEntry.BirdStatus.RE_CATCH,
    }

    response = auth_client.post(LIST_URL, payload, format="json")
    assert response.status_code == 201, response.json()

    entry = DataEntry.objects.get(id=response.json()["id"])
    assert entry.ring.central.scheme_code == "SKB"
    assert entry.ring.size == "6.0"
    assert entry.ring.number == "SK99A"

    detail = auth_client.get(_detail_url(entry.id)).json()
    assert detail["ring"]["central"]["scheme_code"] == "SKB"


@pytest.mark.django_db
def test_payload_without_central_defaults_to_projekt_zentrale_auw(
    auth_client, species, scientist, ringing_station
):
    """The pre-feature outbox shape (no central) replays cleanly: the Ring lands
    under the Projekt-Zentrale — AUW without a Projekt (US 16)."""
    response = auth_client.post(
        LIST_URL,
        _payload(species, scientist, ringing_station, ring_number="0800"),
        format="json",
    )

    assert response.status_code == 201, response.json()
    entry = DataEntry.objects.get(id=response.json()["id"])
    assert entry.ring.central.scheme_code == "AUW"


@pytest.mark.django_db
def test_unknown_scheme_code_is_a_clean_400_not_500(
    auth_client, species, scientist, ringing_station
):
    """An unknown scheme code in the payload is a clean validation error, never
    a 500."""
    payload = {
        **_payload(species, scientist, ringing_station, ring_number="0801"),
        "central": "ZZZ",
        "bird_status": DataEntry.BirdStatus.RE_CATCH,
    }

    response = auth_client.post(LIST_URL, payload, format="json")

    assert response.status_code == 400
    assert "central" in response.json()
    assert DataEntry.objects.count() == 0


@pytest.mark.django_db
def test_erstfang_with_foreign_central_is_rejected_400(
    auth_client, species, scientist, ringing_station
):
    """An Erstfang must carry the Projekt-Zentrale; a foreign central on it is a
    400 with a German detail (US 3)."""
    payload = {
        **_payload(species, scientist, ringing_station, ring_number="0802"),
        "central": "SKB",
        "bird_status": DataEntry.BirdStatus.FIRST_CATCH,
    }

    response = auth_client.post(LIST_URL, payload, format="json")

    assert response.status_code == 400
    assert "central" in response.json()
    assert DataEntry.objects.count() == 0


@pytest.mark.django_db
def test_auw_invalid_size_is_rejected_400(auth_client, species, scientist, ringing_station):
    """Omitting the central keeps the strict Austrian size validation: a Größe
    outside the 28 codes is a 400 (US 8, 16)."""
    payload = _payload(species, scientist, ringing_station, ring_number="0803", ring_size="ZZ")

    response = auth_client.post(LIST_URL, payload, format="json")

    assert response.status_code == 400
    assert "ring_size" in response.json()
    assert DataEntry.objects.count() == 0


@pytest.mark.django_db
def test_foreign_wiederfang_ring_coexists_with_austrian_ring_same_size_number(
    auth_client, species, scientist, ringing_station, organization
):
    """US 18: an Austrian S 0044 Erstfang and a Slovak S 0044 Wiederfang create
    two distinct rings that coexist within the Organisation."""
    austrian = auth_client.post(
        LIST_URL,
        _payload(species, scientist, ringing_station, ring_number="0044", ring_size="S"),
        format="json",
    )
    assert austrian.status_code == 201, austrian.json()

    slovak = auth_client.post(
        LIST_URL,
        {
            **_payload(species, scientist, ringing_station, ring_number="0044", ring_size="S"),
            "central": "SKB",
            "bird_status": DataEntry.BirdStatus.RE_CATCH,
        },
        format="json",
    )
    assert slovak.status_code == 201, slovak.json()

    rings = Ring.objects.filter(organization=organization, size="S", number="0044")
    assert rings.count() == 2
    assert set(rings.values_list("central__scheme_code", flat=True)) == {"AUW", "SKB"}


@pytest.mark.django_db
def test_replaying_the_same_erstfang_create_is_idempotent_not_a_collision(
    auth_client, species, scientist, ringing_station
):
    """The duplicate-Erstfang guard must never mistake a genuine replay (an
    offline outbox retry firing twice under the *same* idempotency key) for a
    collision — the idempotency short-circuit returns the existing row, so a
    replayed create still succeeds and creates no second row (#155/#164)."""
    key = str(uuid.uuid4())
    payload = {
        **_payload(species, scientist, ringing_station, ring_number="822"),
        "idempotency_key": key,
    }

    first = auth_client.post(LIST_URL, payload, format="json")
    assert first.status_code == 201, first.json()

    replay = auth_client.post(LIST_URL, payload, format="json")
    assert replay.status_code == 201, replay.json()
    assert replay.json()["id"] == first.json()["id"]
    assert DataEntry.objects.filter(ring__number="822").count() == 1
