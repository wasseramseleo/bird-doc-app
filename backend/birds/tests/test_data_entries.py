import uuid
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import pytest
from django.conf import settings
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

from birds.models import DataEntry, Project, Ring, UnmigratablePayload
from birds.payload_schema import PAYLOAD_SCHEMA_VERSION

LIST_URL = "/api/birds/data-entries/"
VIENNA = ZoneInfo("Europe/Vienna")

# The Parasit data migration (ADR 0027) and the state right before it — used by
# the migration test that proves a historical Milben capture survives the cutover.
_MIGRATION_BEFORE_PARASIT = "0066_merge_0065_merge_20260716_0065_merge_20260716_0926"
_MIGRATION_PARASIT = "0067_remove_dataentry_has_mites_dataentry_parasites"

# The Parasit vocabulary migration (issue #406) and the state right before it —
# used by the migration test that proves a stored „Milben" capture reads as Rote
# Milben afterwards, and travels back unchanged on a rollback.
_MIGRATION_BEFORE_PARASIT_VOCAB = "0069_remove_dataentry_unique_erstfang_per_ring_and_more"
_MIGRATION_PARASIT_VOCAB = "0070_parasit_mites_to_red_mites"


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


# --- Fangmarker: Tot-Fund & Nicht-Standard-Fang (ADR 0026, issue #371) --------


@pytest.mark.django_db
def test_create_persists_and_serializes_both_fangmarker(
    auth_client, species, scientist, ringing_station
):
    """Both Fangmarker are written on create and read back on the payload, so a
    capture round-trips them (ADR 0026)."""
    payload = _payload(species, scientist, ringing_station, ring_number="900")
    payload["is_dead_recovery"] = True
    payload["is_non_standard"] = True
    payload["comment"] = "Totfund; Umstände: unter dem Netz"

    response = auth_client.post(LIST_URL, payload, format="json")

    assert response.status_code == 201, response.json()
    body = response.json()
    assert body["is_dead_recovery"] is True
    assert body["is_non_standard"] is True
    entry = DataEntry.objects.get(id=body["id"])
    assert entry.is_dead_recovery is True
    assert entry.is_non_standard is True
    # The real Art and Ring are always kept — a marker never substitutes them.
    assert entry.species_id == species.id
    assert entry.ring.number == "900"


@pytest.mark.django_db
def test_markers_default_false_when_omitted(auth_client, species, scientist, ringing_station):
    """A capture that sends no markers persists both as False (nullable-free
    booleans), so a pre-feature payload behaves exactly as before."""
    response = auth_client.post(
        LIST_URL,
        _payload(species, scientist, ringing_station, ring_number="901"),
        format="json",
    )

    assert response.status_code == 201, response.json()
    body = response.json()
    assert body["is_dead_recovery"] is False
    assert body["is_non_standard"] is False


@pytest.mark.django_db
def test_update_toggles_markers(auth_client, data_entry, species, scientist, ringing_station):
    """The markers can be flipped on and off by an edit and survive the write."""
    payload = _payload(species, scientist, ringing_station, ring_number="902")
    payload["is_non_standard"] = True
    payload["comment"] = "Handfang bei einer Vorführung"

    response = auth_client.put(_detail_url(data_entry.id), payload, format="json")

    assert response.status_code == 200, response.json()
    data_entry.refresh_from_db()
    assert data_entry.is_non_standard is True
    assert data_entry.is_dead_recovery is False


@pytest.mark.django_db
def test_create_dead_recovery_without_comment_returns_400(
    auth_client, species, scientist, ringing_station
):
    """A Tot-Fund with a blank Bemerkung is rejected server-side, mirroring the
    Aves-ignota mandatory-comment rule (ADR 0026)."""
    payload = _payload(species, scientist, ringing_station, ring_number="903")
    payload["is_dead_recovery"] = True

    response = auth_client.post(LIST_URL, payload, format="json")

    assert response.status_code == 400
    assert "comment" in response.json()
    assert DataEntry.objects.count() == 0


@pytest.mark.django_db
def test_create_non_standard_without_comment_returns_400(
    auth_client, species, scientist, ringing_station
):
    """A Nicht-Standard-Fang with a blank Bemerkung is rejected server-side."""
    payload = _payload(species, scientist, ringing_station, ring_number="904")
    payload["is_non_standard"] = True

    response = auth_client.post(LIST_URL, payload, format="json")

    assert response.status_code == 400
    assert "comment" in response.json()
    assert DataEntry.objects.count() == 0


@pytest.mark.django_db
def test_marker_with_comment_succeeds(auth_client, species, scientist, ringing_station):
    """A marker with a non-blank Bemerkung passes the mandatory-comment rule."""
    payload = _payload(species, scientist, ringing_station, ring_number="905")
    payload["is_non_standard"] = True
    payload["comment"] = "Zufallsfang"

    response = auth_client.post(LIST_URL, payload, format="json")

    assert response.status_code == 201, response.json()


@pytest.mark.django_db
def test_both_markers_on_aves_ignota_capture(
    auth_client, aves_ignota_species, scientist, ringing_station
):
    """The markers are orthogonal and either may sit on an Aves-ignota bird — both
    may be true at once on the same unlisted capture (ADR 0026)."""
    payload = _payload(aves_ignota_species, scientist, ringing_station, ring_number="906")
    payload["is_dead_recovery"] = True
    payload["is_non_standard"] = True
    payload["comment"] = "Totfund; Umstände: toter Irrgast, außerhalb des Protokolls"

    response = auth_client.post(LIST_URL, payload, format="json")

    assert response.status_code == 201, response.json()
    entry = DataEntry.objects.get(id=response.json()["id"])
    assert entry.is_dead_recovery is True
    assert entry.is_non_standard is True
    assert entry.species.special_kind == "unknown_species"


@pytest.mark.django_db
def test_markers_forced_off_on_ring_destroyed(
    auth_client, sentinel_species, scientist, ringing_station
):
    """A Ring-vernichtet capture has no bird to mark, so the markers are forced off
    server-side regardless of what the client sent, and a blank comment is not
    demanded of it (ADR 0026)."""
    payload = _payload(sentinel_species, scientist, ringing_station, ring_number="907")
    payload["is_dead_recovery"] = True
    payload["is_non_standard"] = True

    response = auth_client.post(LIST_URL, payload, format="json")

    assert response.status_code == 201, response.json()
    entry = DataEntry.objects.get(id=response.json()["id"])
    assert entry.is_dead_recovery is False
    assert entry.is_non_standard is False


@pytest.mark.django_db
def test_update_to_ring_destroyed_forces_markers_off(
    auth_client, data_entry, sentinel_species, scientist, ringing_station
):
    """Editing a marked capture into a Ring-vernichtet record forces both markers
    off on the update path too (ADR 0026), mirroring the create path."""
    data_entry.is_dead_recovery = True
    data_entry.is_non_standard = True
    data_entry.save()

    payload = _payload(sentinel_species, scientist, ringing_station, ring_number="908")
    payload["is_dead_recovery"] = True
    payload["is_non_standard"] = True

    response = auth_client.put(_detail_url(data_entry.id), payload, format="json")

    assert response.status_code == 200, response.json()
    data_entry.refresh_from_db()
    assert data_entry.is_dead_recovery is False
    assert data_entry.is_non_standard is False


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
def test_delete_tombstones_entry_instead_of_dropping_the_row(auth_client, data_entry):
    """DELETE flags the capture; the row is retained so the Betreiber can still
    recover it from the Django admin on request (ADR 0030)."""
    response = auth_client.delete(_detail_url(data_entry.id))

    assert response.status_code == 204
    data_entry.refresh_from_db()
    assert data_entry.is_cancelled is True


@pytest.mark.django_db
def test_restore_clears_the_flag_and_makes_the_capture_visible_again(auth_client, data_entry):
    """The „Rückgängig" snackbar's undo: restore revives the deleted capture.

    It must reach a row that ``get_queryset()`` filters out, so it fetches through
    its own unfiltered — but still org-scoped — queryset (ADR 0030).
    """
    auth_client.delete(_detail_url(data_entry.id))

    response = auth_client.post(f"{_detail_url(data_entry.id)}restore/")

    assert response.status_code == 200
    data_entry.refresh_from_db()
    assert data_entry.is_cancelled is False
    listed = auth_client.get(LIST_URL).json()["results"]
    assert [row["id"] for row in listed] == [str(data_entry.id)]


@pytest.mark.django_db
def test_plain_mitglied_can_delete_and_undo_a_capture(
    mitglied_client, mitglied_scientist, data_entry
):
    """Löschen is ungated: any Mitglied may delete, not just an Admin (ADR 0030).

    Unlike the Beringer- and Norm-Overrides, which a plain Mitglied may not delete,
    a capture carries no admin gate — it matches ``Rolle`` ("erfasst und bearbeitet
    Fänge der gesamten Organisation") and the ungated Heute-Seite delete. Someone
    who may already edit a capture into garbage gains no new power by deleting it.
    The undo behind the „Rückgängig" snackbar is ungated for the same reason.
    """
    response = mitglied_client.delete(_detail_url(data_entry.id))

    assert response.status_code == 204
    data_entry.refresh_from_db()
    assert data_entry.is_cancelled is True

    undo = mitglied_client.post(f"{_detail_url(data_entry.id)}restore/")

    assert undo.status_code == 200
    data_entry.refresh_from_db()
    assert data_entry.is_cancelled is False


@pytest.mark.django_db
def test_restore_of_another_tenants_capture_returns_404(auth_client, data_entry_b):
    """Restore is org-scoped like every other capture route: an unfiltered
    queryset must not become a cross-tenant hole (ADR 0005)."""
    DataEntry.objects.filter(pk=data_entry_b.pk).update(is_cancelled=True)

    response = auth_client.post(f"{_detail_url(data_entry_b.id)}restore/")

    assert response.status_code == 404
    data_entry_b.refresh_from_db()
    assert data_entry_b.is_cancelled is True


@pytest.mark.django_db
def test_is_cancelled_is_not_client_writable(
    auth_client, data_entry, species, scientist, ringing_station
):
    """The flag is moved only by ``destroy`` and ``restore`` — never by a client
    edit, which would be a delete that bypasses the confirm modal (ADR 0030)."""
    payload = _payload(species, scientist, ringing_station, ring_number="903")
    payload["is_cancelled"] = True

    response = auth_client.put(_detail_url(data_entry.id), payload, format="json")

    assert response.status_code == 200, response.json()
    data_entry.refresh_from_db()
    assert data_entry.is_cancelled is False


@pytest.mark.django_db
def test_deleted_capture_disappears_from_letzte_faenge(
    auth_client, species, ring, scientist, ringing_station, project
):
    """„Letzte Fänge" (the ``project=`` mode) never shows a deleted capture —
    it reads as if the entry had never been recorded (ADR 0030)."""
    entry = DataEntry.objects.create(
        species=species,
        ring=ring,
        staff=scientist,
        ringing_station=ringing_station,
        project=project,
        date_time=datetime(2026, 1, 1, tzinfo=UTC),
    )

    auth_client.delete(_detail_url(entry.id))
    response = auth_client.get(LIST_URL, {"project": str(project.id)})

    assert response.status_code == 200
    assert response.json()["count"] == 0


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
def test_replaying_a_deleted_entrys_idempotency_key_finds_the_tombstone_and_creates_nothing(
    auth_client, species, scientist, ringing_station
):
    """The **one** deliberate exception to the invisibility rule (ADR 0030): the
    idempotency replay lookup must still resolve a *deleted* row.

    Otherwise an offline device replaying its outbox after the capture was
    deleted would silently re-create it — the entry would rise from the dead.
    The replay hands back the tombstone itself and mints nothing.
    """
    payload = _payload(species, scientist, ringing_station, ring_number="752")
    payload["idempotency_key"] = "55555555-5555-5555-5555-555555555555"
    first = auth_client.post(LIST_URL, payload, format="json")
    assert first.status_code == 201, first.json()
    auth_client.delete(_detail_url(first.json()["id"]))

    replay = auth_client.post(LIST_URL, payload, format="json")

    assert replay.status_code == 201, replay.json()
    assert replay.json()["id"] == first.json()["id"]
    assert DataEntry.objects.count() == 1
    # The replay resolves the row but does not resurrect it: it stays deleted.
    assert DataEntry.objects.get(id=first.json()["id"]).is_cancelled is True


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
def test_ring_filter_trims_whitespace_around_the_ring_number(
    auth_client, species, scientist, ringing_station
):
    """A ring searched with surrounding whitespace still finds its captures (#404).

    DRF's ``CharField`` trims on write (``trim_whitespace=True``), so a posted
    `" 123 "` is *stored* as `"123"`. Filtering on the raw query param made the
    read path asymmetric to the write path: the Wiederfang-Historie of a pasted
    ring came back empty and the Beringer was told the bird was unknown, while it
    sat in the database all along. Trimming the param closes the asymmetry at its
    origin, rather than trusting every client to remember.
    """
    ring = Ring.objects.create(number="123", size=Ring.RingSizes.V)
    target = DataEntry.objects.create(
        species=species,
        ring=ring,
        staff=scientist,
        ringing_station=ringing_station,
        date_time=datetime(2026, 1, 1, tzinfo=UTC),
    )

    response = auth_client.get(LIST_URL, {"ring_size": "V", "ring_number": " 123 "})

    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1
    assert body["results"][0]["id"] == str(target.id)


@pytest.mark.django_db
def test_ring_filter_preserves_whitespace_inside_the_ring_number(
    auth_client, species, scientist, ringing_station
):
    """Inner whitespace is part of the number, not noise around it (#404).

    A foreign Zentrale's ring may legitimately read `"AB 1234"`, and that is how
    it is stored. Only the surrounding whitespace is stripped — a „remove every
    space" rule would make such a ring unfindable, trading one failure for
    another.
    """
    spaced_ring = Ring.objects.create(number="AB 1234", size=Ring.RingSizes.V)
    target = DataEntry.objects.create(
        species=species,
        ring=spaced_ring,
        staff=scientist,
        ringing_station=ringing_station,
        date_time=datetime(2026, 1, 1, tzinfo=UTC),
    )

    found = auth_client.get(LIST_URL, {"ring_size": "V", "ring_number": " AB 1234 "})
    assert found.status_code == 200
    assert [row["id"] for row in found.json()["results"]] == [str(target.id)]

    # The inner space is load-bearing: collapsing it must not silently match.
    collapsed = auth_client.get(LIST_URL, {"ring_size": "V", "ring_number": "AB1234"})
    assert collapsed.json()["count"] == 0


@pytest.mark.django_db
def test_ring_filter_ignores_an_all_whitespace_ring_number(auth_client, data_entry):
    """A blank-after-trim ring number is no filter at all (#404).

    `" "` carries no ring to search for. It must fall through to the unfiltered
    list exactly like an absent param — never narrow the queryset to the empty
    string and report „nichts gefunden" for a ring nobody asked about.
    """
    response = auth_client.get(LIST_URL, {"ring_size": "V", "ring_number": "   "})

    assert response.status_code == 200
    assert response.json()["count"] == DataEntry.objects.filter(is_cancelled=False).count()


@pytest.mark.django_db
def test_deleted_erstfang_frees_its_ring_number_for_a_new_erstfang(
    auth_client, species, scientist, ringing_station
):
    """The number returns to the rope: deleting an Erstfang lets the same
    physical ring be issued again (ADR 0030).

    Driven over HTTP on purpose — only the full stack proves the *widened*
    ``unique_erstfang_per_ring`` index actually took effect. A pre-check-only fix
    would still be refused by the database here.
    """
    payload = _payload(species, scientist, ringing_station, ring_number="4711")
    first = auth_client.post(LIST_URL, payload, format="json")
    assert first.status_code == 201, first.json()

    auth_client.delete(_detail_url(first.json()["id"]))
    second = auth_client.post(LIST_URL, payload, format="json")

    assert second.status_code == 201, second.json()
    assert second.json()["id"] != first.json()["id"]
    # The tombstone is retained alongside the fresh Erstfang; only the live one
    # is an Erstfang as far as every query is concerned.
    assert DataEntry.objects.filter(ring__number="4711").count() == 2
    assert DataEntry.objects.filter(ring__number="4711", is_cancelled=False).count() == 1


@pytest.mark.django_db
def test_deleted_capture_disappears_from_wiederfang_historie(
    auth_client, species, scientist, ringing_station
):
    """The Wiederfang-Historie of a ring (the ``ring_size``/``ring_number`` mode)
    never shows a deleted capture — the same invisibility rule as „Letzte Fänge",
    since both modes are the same queryset (ADR 0030)."""
    ring = Ring.objects.create(number="123", size=Ring.RingSizes.V)
    erstfang = DataEntry.objects.create(
        species=species,
        ring=ring,
        staff=scientist,
        ringing_station=ringing_station,
        bird_status=DataEntry.BirdStatus.FIRST_CATCH,
        date_time=datetime(2026, 1, 1, tzinfo=UTC),
    )
    wiederfang = DataEntry.objects.create(
        species=species,
        ring=ring,
        staff=scientist,
        ringing_station=ringing_station,
        bird_status=DataEntry.BirdStatus.RE_CATCH,
        date_time=datetime(2026, 1, 2, tzinfo=UTC),
    )

    auth_client.delete(_detail_url(wiederfang.id))
    response = auth_client.get(LIST_URL, {"ring_size": "V", "ring_number": "123"})

    assert response.status_code == 200
    body = response.json()
    assert [row["id"] for row in body["results"]] == [str(erstfang.id)]


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


# --- Parasit multi-select (ADR 0027, issue #376) ------------------------------
# Milben is generalised into a multi-valued Parasit field: a JSONField list of
# fixed, app-wide choice codes (e.g. ["mites"]). The list persists and
# round-trips on create/update; an omitted field defaults to the empty list;
# and the former ``has_mites`` boolean no longer exists on the API.


@pytest.mark.django_db
def test_create_persists_and_serializes_parasites(auth_client, species, scientist, ringing_station):
    """A capture's Parasit selection is stored as a JSON list of codes and read
    back verbatim on the create response — a full round-trip (ADR 0027)."""
    payload = _payload(species, scientist, ringing_station, ring_number="910")
    payload["parasites"] = ["red_mites"]

    response = auth_client.post(LIST_URL, payload, format="json")

    assert response.status_code == 201, response.json()
    body = response.json()
    assert body["parasites"] == ["red_mites"]
    entry = DataEntry.objects.get(id=body["id"])
    assert entry.parasites == ["red_mites"]


@pytest.mark.django_db
def test_unknown_parasite_code_is_rejected(auth_client, species, scientist, ringing_station):
    """A code outside the vocabulary is refused at the door (issue #406).

    Both consumers fall back to the raw code by design (``_PARASIT_LABELS.get(
    code, code)``), so without this an enum typo would sail through and land as a
    literal ``white_mites`` in the Bemerkungen column of the official Meldung,
    failing nowhere. The two hand-mirrored enums make that drift realistic."""
    payload = _payload(species, scientist, ringing_station, ring_number="913")
    payload["parasites"] = ["banana"]

    response = auth_client.post(LIST_URL, payload, format="json")

    assert response.status_code == 400, response.json()
    assert "parasites" in response.json()
    assert not DataEntry.objects.filter(ring__number="913").exists()


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("ring_number", "parasites"),
    [
        ("913a", [["nested"]]),
        ("913b", [{}]),
        ("913c", [{"a": 1}]),
        ("913d", [42]),
        ("913e", [None]),
    ],
)
def test_malformed_parasite_json_is_rejected_not_a_server_error(
    auth_client, species, scientist, ringing_station, ring_number, parasites
):
    """A non-string element is a *client* error (400), never a 500 (issue #406).

    The alias rewrite must not assume the incoming value is hashable: a bare
    ``PARASIT_ALIASES.get(data, data)`` raises ``TypeError: unhashable type`` on
    a list or dict and turns a malformed payload into an unhandled server fault.

    A 500 is strictly worse here than the 4xx it replaces, because of the very
    mechanism the alias exists to protect: ``sync.service.ts::syncEntry`` flags a
    4xx per entry (skip-and-flag) but treats a 5xx as *transient* and stops the
    whole replay run. One malformed queued payload would head-of-line-block the
    entire outbox on every reconnect and never drain."""
    payload = _payload(species, scientist, ringing_station, ring_number=ring_number)
    payload["parasites"] = parasites

    response = auth_client.post(LIST_URL, payload, format="json")

    assert response.status_code == 400, response.json()
    assert "parasites" in response.json()
    assert not DataEntry.objects.filter(ring__number=ring_number).exists()


@pytest.mark.django_db
def test_retired_mites_code_is_accepted_and_rewritten(
    auth_client, species, scientist, ringing_station
):
    """An old offline bundle may still POST the retired ``mites`` code — it is
    accepted and stored as ``red_mites`` (issue #406).

    Rejecting it would be a field bug, not strictness: a device can be offline
    ~30 days and an open PWA tab runs an old bundle indefinitely, so a 4xx on
    replay hits skip-and-flag — the capture stays in IndexedDB, is skipped by
    every later replay, and the ringer's only repair path is the *old* form that
    offers „Milben" again. A loop nothing breaks him out of."""
    payload = _payload(species, scientist, ringing_station, ring_number="914")
    payload["parasites"] = ["mites"]

    response = auth_client.post(LIST_URL, payload, format="json")

    assert response.status_code == 201, response.json()
    assert response.json()["parasites"] == ["red_mites"]
    assert DataEntry.objects.get(ring__number="914").parasites == ["red_mites"]


@pytest.mark.django_db
def test_several_parasite_types_round_trip(auth_client, species, scientist, ringing_station):
    """Several types on one capture is an ordinary finding — Zecken *and* Rote
    Milben — and the whole selection round-trips in the order it was sent."""
    payload = _payload(species, scientist, ringing_station, ring_number="915")
    payload["parasites"] = ["red_mites", "tick", "louse_fly"]

    response = auth_client.post(LIST_URL, payload, format="json")

    assert response.status_code == 201, response.json()
    assert response.json()["parasites"] == ["red_mites", "tick", "louse_fly"]
    assert DataEntry.objects.get(ring__number="915").parasites == [
        "red_mites",
        "tick",
        "louse_fly",
    ]


@pytest.mark.django_db
def test_parasites_default_to_empty_list_when_omitted(
    auth_client, species, scientist, ringing_station
):
    """A capture that sends no Parasit selection persists an empty list — the
    field's default — so a pre-feature payload behaves as 'no parasites'."""
    response = auth_client.post(
        LIST_URL,
        _payload(species, scientist, ringing_station, ring_number="911"),
        format="json",
    )

    assert response.status_code == 201, response.json()
    assert response.json()["parasites"] == []


@pytest.mark.django_db
def test_update_replaces_parasites_list(
    auth_client, data_entry, species, scientist, ringing_station
):
    """An edit replaces the whole Parasit list and the new selection survives the
    write."""
    payload = _payload(species, scientist, ringing_station, ring_number="912")
    payload["parasites"] = ["red_mites"]

    response = auth_client.put(_detail_url(data_entry.id), payload, format="json")

    assert response.status_code == 200, response.json()
    data_entry.refresh_from_db()
    assert data_entry.parasites == ["red_mites"]


@pytest.mark.django_db
def test_has_mites_replaced_by_parasites_on_the_api(auth_client, data_entry):
    """The former single ``has_mites`` boolean is gone from the serialized
    capture; ``parasites`` takes its place (ADR 0027)."""
    response = auth_client.get(_detail_url(data_entry.id))

    assert response.status_code == 200
    body = response.json()
    assert "has_mites" not in body
    assert "parasites" in body


@pytest.mark.django_db(transaction=True)
def test_has_mites_true_migrates_to_parasites_mites():
    """The data migration carries a historical Milben capture forward: a row with
    ``has_mites=True`` before the migration reads ``parasites == ["mites"]`` after
    it (and a ``has_mites=False`` row becomes an empty list), so historical Milben
    entries keep their meaning as Parasit = Milben (ADR 0027)."""
    executor = MigrationExecutor(connection)
    try:
        # Rewind to the state that still carries the has_mites boolean.
        executor.migrate([("birds", _MIGRATION_BEFORE_PARASIT)])
        old_apps = executor.loader.project_state([("birds", _MIGRATION_BEFORE_PARASIT)]).apps

        Organization = old_apps.get_model("birds", "Organization")
        Species = old_apps.get_model("birds", "Species")
        RingModel = old_apps.get_model("birds", "Ring")
        Scientist = old_apps.get_model("birds", "Scientist")
        RingingStation = old_apps.get_model("birds", "RingingStation")
        Historic = old_apps.get_model("birds", "DataEntry")

        org = Organization.objects.create(handle="MIGORG", name="Mig Org", country="AT")
        sp = Species.objects.create(
            common_name_de="Milbenvogel",
            common_name_en="Mite Bird",
            scientific_name="Acarus avis",
            family_name="Testidae",
            order_name="Testiformes",
        )
        sc = Scientist.objects.create(handle="MIG", organization=org)
        st = RingingStation.objects.create(handle="MIGSTN", name="Mig Station", organization=org)
        mites_entry = Historic.objects.create(
            species=sp,
            ring=RingModel.objects.create(number="700", size="V", organization=org),
            staff=sc,
            ringing_station=st,
            organization=org,
            has_mites=True,
            date_time=datetime(2020, 5, 1, 8, 0, tzinfo=UTC),
        )
        clean_entry = Historic.objects.create(
            species=sp,
            ring=RingModel.objects.create(number="701", size="V", organization=org),
            staff=sc,
            ringing_station=st,
            organization=org,
            has_mites=False,
            date_time=datetime(2020, 5, 1, 9, 0, tzinfo=UTC),
        )

        # Apply the Parasit migration.
        executor.loader.build_graph()
        executor.migrate([("birds", _MIGRATION_PARASIT)])
        new_apps = executor.loader.project_state([("birds", _MIGRATION_PARASIT)]).apps
        Migrated = new_apps.get_model("birds", "DataEntry")

        assert Migrated.objects.get(pk=mites_entry.pk).parasites == ["mites"]
        assert Migrated.objects.get(pk=clean_entry.pk).parasites == []
    finally:
        # Always leave the DB migrated forward to the latest state so the rest of
        # the session's tests run against the current schema.
        executor.loader.build_graph()
        executor.migrate(executor.loader.graph.leaf_nodes())


# --- Parasit vocabulary: „Milben" becomes Rote Milben (issue #406) ------------
# The user's ruling: the historical „Milben" option always meant Dermanyssus
# gallinae. The vocabulary now names five concrete types, so every stored
# ``mites`` is rewritten to ``red_mites`` at rest — and the write path keeps
# accepting ``mites`` from old offline bundles (see the alias tests below).


@pytest.mark.django_db(transaction=True)
def test_stored_mites_migrates_to_red_mites_and_back():
    """A stored „Milben" capture reads as Rote Milben after the vocabulary
    migration, and travels back to ``mites`` on a rollback — the migration is
    reversible, so a bad release can be undone without stranding the data
    (issue #406)."""
    executor = MigrationExecutor(connection)
    try:
        executor.migrate([("birds", _MIGRATION_BEFORE_PARASIT_VOCAB)])
        old_apps = executor.loader.project_state([("birds", _MIGRATION_BEFORE_PARASIT_VOCAB)]).apps

        Organization = old_apps.get_model("birds", "Organization")
        Species = old_apps.get_model("birds", "Species")
        RingModel = old_apps.get_model("birds", "Ring")
        Scientist = old_apps.get_model("birds", "Scientist")
        RingingStation = old_apps.get_model("birds", "RingingStation")
        Historic = old_apps.get_model("birds", "DataEntry")

        org = Organization.objects.create(handle="VOCORG", name="Voc Org", country="AT")
        sp = Species.objects.create(
            common_name_de="Milbenvogel",
            common_name_en="Mite Bird",
            scientific_name="Acarus avis",
            family_name="Testidae",
            order_name="Testiformes",
        )
        sc = Scientist.objects.create(handle="VOC", organization=org)
        st = RingingStation.objects.create(handle="VOCSTN", name="Voc Station", organization=org)

        def _entry(number, parasites, hour):
            return Historic.objects.create(
                species=sp,
                ring=RingModel.objects.create(number=number, size="V", organization=org),
                staff=sc,
                ringing_station=st,
                organization=org,
                parasites=parasites,
                date_time=datetime(2020, 5, 1, hour, 0, tzinfo=UTC),
            )

        mites_entry = _entry("710", ["mites"], 8)
        clean_entry = _entry("711", [], 9)
        # A capture that already carries another type alongside Milben must keep
        # that type, in place — the rewrite touches only the retired code.
        mixed_entry = _entry("712", ["mites", "tick"], 10)

        executor.loader.build_graph()
        executor.migrate([("birds", _MIGRATION_PARASIT_VOCAB)])
        new_apps = executor.loader.project_state([("birds", _MIGRATION_PARASIT_VOCAB)]).apps
        Migrated = new_apps.get_model("birds", "DataEntry")

        assert Migrated.objects.get(pk=mites_entry.pk).parasites == ["red_mites"]
        assert Migrated.objects.get(pk=clean_entry.pk).parasites == []
        assert Migrated.objects.get(pk=mixed_entry.pk).parasites == ["red_mites", "tick"]

        # Reverse: back to the retired code, order preserved.
        executor.loader.build_graph()
        executor.migrate([("birds", _MIGRATION_BEFORE_PARASIT_VOCAB)])
        reversed_apps = executor.loader.project_state(
            [("birds", _MIGRATION_BEFORE_PARASIT_VOCAB)]
        ).apps
        Reversed = reversed_apps.get_model("birds", "DataEntry")

        assert Reversed.objects.get(pk=mites_entry.pk).parasites == ["mites"]
        assert Reversed.objects.get(pk=clean_entry.pk).parasites == []
        assert Reversed.objects.get(pk=mixed_entry.pk).parasites == ["mites", "tick"]
    finally:
        executor.loader.build_graph()
        executor.migrate(executor.loader.graph.leaf_nodes())


# --- Payload-Schema-Stempel: der Replay-Pfad ist nachsichtig (ADR 0033, #408) --
# An outbox payload is frozen at queue time and lives in IndexedDB, which
# outlives any bundle swap: a device can be offline ~30 days and then replays a
# month-old payload against today's contract with nothing detecting the drift.
# The stamp makes that drift legible. Migration is server-side — not a
# preference but the only option, since the bundle replaying a June payload *is*
# the June bundle and has never heard of July. A payload the server cannot bring
# onto today's contract is nonetheless ALWAYS accepted: it is held raw and the
# operator is alerted, rather than rejected (which would strand it) or recorded
# (which would put a measurement nobody can interpret into the Fangdaten).


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("ring_number", "schema_version"),
    [
        # Too old: from a contract whose migration step has since been retired.
        # The case ADR 0033 names, and unreachable today by construction — the
        # floor sits at the pre-versioning contract, so nothing real is below it.
        ("940a", -1),
        # Too new: a contract this server has never heard of. Reachable only by
        # rolling the server back behind the bundle its devices still run.
        ("940b", 99),
        # Not a version at all. Held like the rest rather than 400'd — and it must
        # never become a 500, which is what reading it as a number would do.
        ("940c", "banana"),
        ("940d", None),
        ("940e", {"nested": 1}),
        # ``bool`` is an ``int`` subclass: ``True`` must not pass for version 1.
        ("940f", True),
    ],
)
def test_unmigratable_payload_is_accepted_but_never_reaches_the_fangdaten(
    auth_client, species, scientist, ringing_station, ring_number, schema_version
):
    """A payload the server cannot migrate is accepted (200), not recorded (ADR 0033).

    Rejecting it is the ADR 0031 trap: a 4xx is skip-and-flag, which strands a
    real capture and blames the Beringer for the bundle we shipped him. But
    recording it is worse than either — the server by definition cannot say what
    an unmigratable payload *means*, so a possibly-misinterpreted Flügellänge
    would travel on to the Zentrale looking like every other row.

    Every face of "unmigratable" takes the same lenient exit, because they all
    mean the one thing: the server cannot say what this payload means.
    """
    payload = _payload(species, scientist, ringing_station, ring_number=ring_number)
    payload["schema_version"] = schema_version

    response = auth_client.post(LIST_URL, payload, format="json")

    # Always accepted — the device dequeues, nothing strands, nothing loops.
    assert response.status_code == 200, response.json()
    # ...but it is not a Fang, and it drew no ring off the rope either.
    assert not DataEntry.objects.filter(ring__number=ring_number).exists()
    assert not Ring.objects.filter(number=ring_number).exists()
    # It is parked instead, so nothing is silently dropped.
    assert UnmigratablePayload.objects.count() == 1


@pytest.mark.django_db
def test_unmigratable_payload_is_held_verbatim_and_alerts_the_operator(
    auth_client, user, species, scientist, ringing_station, mailoutbox
):
    """The capture is parked raw, with its stamp, and a human is told (ADR 0033).

    An alarm with a data attachment, not an inbox: the row is the evidence (the
    server could not read the payload, so it must not paraphrase it) and the mail
    is the alarm. Reaching here at all means something is broken — an alias or a
    migration step was retired while the outbox could still be holding a payload
    that old (ADR 0031's invariant) — so it has to be loud.
    """
    payload = _payload(species, scientist, ringing_station, ring_number="941")
    payload["schema_version"] = 99

    response = auth_client.post(LIST_URL, payload, format="json")

    assert response.status_code == 200, response.json()
    held = UnmigratablePayload.objects.get()
    # Verbatim: exactly what arrived, stamp included — nothing normalised away.
    assert held.payload == payload
    assert held.schema_version == 99
    # Whose device it was, so a human knows whom to ask.
    assert held.submitted_by == user
    # And the operator hears about it, once.
    assert len(mailoutbox) == 1
    assert mailoutbox[0].to == [settings.OPERATOR_EMAIL]


@pytest.mark.django_db
def test_current_stamp_is_recorded_as_an_ordinary_capture(
    auth_client, species, scientist, ringing_station, mailoutbox
):
    """A payload speaking today's contract is just a Fang (ADR 0033).

    ``schema_version == PAYLOAD_SCHEMA_VERSION`` is the all-clear — which is the
    whole reason the stamp is a *schema* version and not a build version, since a
    build version churns on every release and would make every payload look
    drifted. The stamp is a fact about the contract, not about the bird: it
    steers the replay and is then dropped, never persisted onto the capture.
    """
    payload = _payload(species, scientist, ringing_station, ring_number="942")
    payload["schema_version"] = PAYLOAD_SCHEMA_VERSION

    response = auth_client.post(LIST_URL, payload, format="json")

    assert response.status_code == 201, response.json()
    entry = DataEntry.objects.get(ring__number="942")
    assert entry.ring.size == "V"
    # Nothing was held and nobody was woken up.
    assert not UnmigratablePayload.objects.exists()
    assert mailoutbox == []
    # The stamp steered the replay; it is not part of the capture.
    assert "schema_version" not in response.json()


@pytest.mark.django_db
def test_missing_stamp_is_the_pre_versioning_contract_and_is_recorded(
    auth_client, species, scientist, ringing_station, mailoutbox
):
    """An unstamped payload is the contract as it stood before stamping (ADR 0033).

    Stamping is itself a contract change, so it has to tolerate its own absence
    from day one: on the morning this ships, every payload already sitting in a
    real device's outbox carries no stamp. Treating "no stamp" as anything but a
    known contract would strand exactly the captures the stamp exists to protect.
    """
    payload = _payload(species, scientist, ringing_station, ring_number="943")
    assert "schema_version" not in payload

    response = auth_client.post(LIST_URL, payload, format="json")

    assert response.status_code == 201, response.json()
    assert DataEntry.objects.filter(ring__number="943").exists()
    assert not UnmigratablePayload.objects.exists()
    assert mailoutbox == []


@pytest.mark.django_db
def test_stamp_check_leaves_a_form_encoded_create_intact(
    auth_client, species, scientist, ringing_station
):
    """Reading the stamp must not disturb a non-JSON create.

    DRF hands a form-encoded request a ``QueryDict``, and copying one with
    ``dict()`` lifts every value into a list — which would quietly corrupt a
    payload the migration is only meant to pass through. Every other test here
    posts JSON, so nothing else covers the parser the stamp check now sits in
    front of.
    """
    payload = _payload(species, scientist, ringing_station, ring_number="944")

    # APIClient's default format — multipart, not JSON.
    response = auth_client.post(LIST_URL, payload)

    assert response.status_code == 201, response.json()
    assert DataEntry.objects.filter(ring__number="944").exists()


@pytest.mark.django_db
def test_unmigratable_payload_survives_a_failing_alert(
    auth_client, species, scientist, ringing_station, monkeypatch
):
    """A broken mail channel must not cost the capture (ADR 0033).

    Letting the send failure escape would be worse than the outage it reports: a
    500 reads as transient to the replay, so the device would retry the same
    payload forever and mint a fresh held row every time — breaking the very
    promise ("nothing strands, nothing loops") this path exists to keep.
    """

    def explode(self):
        raise OSError("SMTP is down")

    monkeypatch.setattr("birds.payload_schema.EmailMessage.send", explode)
    payload = _payload(species, scientist, ringing_station, ring_number="945")
    payload["schema_version"] = 99

    response = auth_client.post(LIST_URL, payload, format="json")

    # Still accepted, so the device still dequeues...
    assert response.status_code == 200, response.json()
    # ...and the evidence — the durable half of the alarm — is still parked.
    assert UnmigratablePayload.objects.get().payload["schema_version"] == 99
    assert not DataEntry.objects.filter(ring__number="945").exists()


@pytest.mark.django_db
@pytest.mark.parametrize(
    "body",
    [
        # A list body — what DRF has always answered "Expected a dictionary, but
        # got list" to.
        [],
        [{"ring_number": "946"}],
        # A bare string body.
        "banana",
        # Bodies whose *contents* happen to mention the stamp's wire name: a
        # membership test alone ("is the field there?") reads True on both, so
        # they are what turns a careless mapping assumption into a 500.
        ["schema_version"],
        "schema_version",
    ],
)
def test_a_body_that_is_not_a_payload_is_still_a_bad_request(auth_client, mailoutbox, body):
    """Reading the stamp must not make a malformed body worse (ADR 0033).

    The stamp check sits in front of DRF's own parser validation, so it meets
    bodies the serializer used to reject on its own. It must stay at least as
    tolerant as what it now precedes: a body that is not a mapping carries no
    stamp and cannot carry one, so it passes through untouched and earns the same
    400 it always did.

    Deliberately **not** the holding area. That exit exists for a real capture the
    server cannot interpret — it accepts (200) so the device dequeues, and pays
    for it with an operator alert and a held row. A malformed request is not a
    capture at all: routing it there would mint alarms out of garbage, write junk
    rows, and tell whoever sent it that it was accepted.
    """
    response = auth_client.post(LIST_URL, body, format="json")

    assert response.status_code == 400, response.content
    assert not UnmigratablePayload.objects.exists()
    assert mailoutbox == []
