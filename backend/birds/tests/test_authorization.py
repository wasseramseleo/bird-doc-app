"""Rolle authorization: Admin-only structural management vs Mitglied capture CRUD.

Issue #76 / ADR 0005. Admin manages the Organisation's structure (Projekte,
Stationen, the Organisation itself, the IWM export); a plain Mitglied records and
edits captures across the whole Organisation but may not manage its structure. A
no-account Beringer quick-add stays open to any Mitglied (ADR 0001).

The tests act on the two-tenant harness from ``conftest``: ``scientist`` (Alice)
is an Admin of tenant A, ``mitglied_scientist`` (Mara) is a plain Mitglied of the
same tenant, and tenant B (``*_b``) proves an Admin cannot reach across tenants.
"""

import pytest

from birds.models import FALLBACK_BERINGER_HANDLE, DataEntry, Project, RingingStation, Scientist

PROJECTS_URL = "/api/birds/projects/"
DATA_ENTRIES_URL = "/api/birds/data-entries/"
SPECIES_LISTS_URL = "/api/birds/species-lists/"
SCIENTISTS_URL = "/api/birds/scientists/"
STATIONS_URL = "/api/birds/ringing-stations/"
ORGS_URL = "/api/birds/organizations/"


def _capture_payload(species, staff, ringing_station, *, ring_number, ring_size="V"):
    return {
        "species_id": str(species.id),
        "staff_id": staff.id,
        "ringing_station_id": ringing_station.handle,
        "ring_number": ring_number,
        "ring_size": ring_size,
        "date_time": "2026-03-01T12:00:00Z",
    }


@pytest.mark.django_db
def test_mitglied_cannot_create_project(mitglied_client, mitglied_scientist, organization):
    response = mitglied_client.post(
        PROJECTS_URL,
        {"title": "P", "organization_id": organization.handle},
        format="json",
    )
    assert response.status_code == 403


@pytest.mark.django_db
def test_mitglied_cannot_edit_project(mitglied_client, mitglied_scientist, project):
    response = mitglied_client.patch(
        f"{PROJECTS_URL}{project.id}/", {"title": "Renamed"}, format="json"
    )
    assert response.status_code == 403
    project.refresh_from_db()
    assert project.title == "My Project"


@pytest.mark.django_db
def test_mitglied_cannot_delete_project(mitglied_client, mitglied_scientist, project):
    response = mitglied_client.delete(f"{PROJECTS_URL}{project.id}/")
    assert response.status_code == 403
    assert Project.objects.filter(id=project.id).exists()


@pytest.mark.django_db
def test_admin_can_create_edit_and_delete_project(auth_client, scientist, organization):
    create = auth_client.post(
        PROJECTS_URL, {"title": "P", "organization_id": organization.handle}, format="json"
    )
    assert create.status_code == 201, create.json()
    project_id = create.json()["id"]

    edit = auth_client.patch(f"{PROJECTS_URL}{project_id}/", {"title": "P2"}, format="json")
    assert edit.status_code == 200, edit.json()

    delete = auth_client.delete(f"{PROJECTS_URL}{project_id}/")
    assert delete.status_code == 204
    assert not Project.objects.filter(id=project_id).exists()


@pytest.mark.django_db
def test_admin_only_refusal_carries_a_friendly_message(
    mitglied_client, mitglied_scientist, project
):
    """AC: a refused Mitglied gets a clear, friendly error, not a bare 403."""
    response = mitglied_client.delete(f"{PROJECTS_URL}{project.id}/")

    assert response.status_code == 403
    detail = response.json().get("detail", "")
    assert detail and "Administrator" in detail


# --- IWM export: Admin-only even though it is a GET --------------------------


@pytest.mark.django_db
def test_mitglied_on_project_cannot_pull_iwm_export(mitglied_client, mitglied_scientist, project):
    # Mara is a member of the project (so the row is visible to her) but a plain
    # Mitglied: the export is a privileged action, refused despite being a GET.
    project.scientists.add(mitglied_scientist)

    response = mitglied_client.get(f"{PROJECTS_URL}{project.id}/export-iwm/")

    assert response.status_code == 403
    assert "Administrator" in response.json().get("detail", "")


@pytest.mark.django_db
def test_admin_can_pull_iwm_export(auth_client, scientist, project):
    response = auth_client.get(f"{PROJECTS_URL}{project.id}/export-iwm/")

    assert response.status_code == 200
    assert response["Content-Type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )


# --- Mitglied retains capture CRUD, SpeciesLists and Beringer quick-add ------


@pytest.mark.django_db
def test_mitglied_reads_organisation_captures(mitglied_client, mitglied_scientist, data_entry):
    response = mitglied_client.get(DATA_ENTRIES_URL)

    ids = [row["id"] for row in response.json()["results"]]
    assert str(data_entry.id) in ids


@pytest.mark.django_db
def test_mitglied_can_create_capture(
    mitglied_client, mitglied_scientist, species, ringing_station, organization
):
    response = mitglied_client.post(
        DATA_ENTRIES_URL,
        _capture_payload(species, mitglied_scientist, ringing_station, ring_number="210"),
        format="json",
    )

    assert response.status_code == 201, response.json()
    assert DataEntry.objects.get(id=response.json()["id"]).organization == organization


@pytest.mark.django_db
def test_mitglied_can_edit_and_delete_any_capture_in_the_organisation(
    mitglied_client, mitglied_scientist, data_entry, species, ringing_station
):
    # data_entry was recorded by Alice (Admin) but belongs to tenant A; capture
    # CRUD is org-wide, so a plain Mitglied of the same Organisation may edit and
    # delete it (not just their own records).
    detail = f"{DATA_ENTRIES_URL}{data_entry.id}/"

    edit = mitglied_client.put(
        detail,
        {
            **_capture_payload(species, mitglied_scientist, ringing_station, ring_number="211"),
            "comment": "Korrektur durch Mitglied",
        },
        format="json",
    )
    assert edit.status_code == 200, edit.json()
    data_entry.refresh_from_db()
    assert data_entry.comment == "Korrektur durch Mitglied"

    delete = mitglied_client.delete(detail)
    assert delete.status_code == 204
    assert not DataEntry.objects.filter(id=data_entry.id).exists()


@pytest.mark.django_db
def test_mitglied_can_manage_own_species_lists(mitglied_client, mitglied_scientist, species):
    create = mitglied_client.post(
        SPECIES_LISTS_URL,
        {"name": "Maras Liste", "species_ids": [str(species.id)]},
        format="json",
    )
    assert create.status_code == 201, create.json()
    list_id = create.json()["id"]

    activate = mitglied_client.patch(
        f"{SPECIES_LISTS_URL}{list_id}/", {"is_active": True}, format="json"
    )
    assert activate.status_code == 200, activate.json()

    delete = mitglied_client.delete(f"{SPECIES_LISTS_URL}{list_id}/")
    assert delete.status_code == 204


@pytest.mark.django_db
def test_mitglied_can_quick_add_no_account_beringer(mitglied_client, mitglied_scientist):
    """Any Mitglied may quick-add a no-account Beringer mid-session (ADR 0001)."""
    response = mitglied_client.post(
        SCIENTISTS_URL, {"first_name": "Hans", "last_name": "Helfer"}, format="json"
    )

    assert response.status_code == 201, response.json()
    assert Scientist.objects.get(handle="HHE").user is None


# --- Station management: Admin-only, scoped to the actor's own Organisation ---


def _station_payload(name="Neue Station", **overrides):
    """A valid create payload: name + place_code + latitude + longitude (the
    serializer-required fields). ``handle`` is server-owned and never sent."""
    payload = {
        "name": name,
        "place_code": "AU03",
        "latitude": "48.295892",
        "longitude": "14.276697",
    }
    payload.update(overrides)
    return payload


@pytest.mark.django_db
def test_admin_create_station_derives_handle_and_defaults_country(
    auth_client, scientist, organization
):
    response = auth_client.post(STATIONS_URL, _station_payload(), format="json")

    assert response.status_code == 201, response.json()
    body = response.json()
    # Handle is server-owned (never client-supplied) and returned as the record id.
    assert body["handle"]
    station = RingingStation.objects.get(handle=body["handle"])
    assert station.name == "Neue Station"
    assert station.organization_id == organization.handle
    assert station.place_code == "AU03"
    assert str(station.latitude) == "48.295892"
    assert str(station.longitude) == "14.276697"
    assert station.is_active is True
    # Country defaults to the creating Organisation's country when omitted.
    assert station.country == organization.country == "DE"


@pytest.mark.django_db
def test_admin_create_station_keeps_explicit_country_and_region(
    auth_client, scientist, organization
):
    response = auth_client.post(
        STATIONS_URL,
        _station_payload(country="Austria", region="Oberösterreich"),
        format="json",
    )

    assert response.status_code == 201, response.json()
    station = RingingStation.objects.get(handle=response.json()["handle"])
    assert station.country == "Austria"
    assert station.region == "Oberösterreich"


@pytest.mark.django_db
@pytest.mark.parametrize("missing", ["name", "place_code", "latitude", "longitude"])
def test_admin_create_station_requires_core_fields_with_german_message(
    auth_client, scientist, missing
):
    payload = _station_payload()
    payload.pop(missing)

    response = auth_client.post(STATIONS_URL, payload, format="json")

    assert response.status_code == 400
    assert missing in response.json()
    # The error is a clear German (non-English) message.
    message = " ".join(response.json()[missing])
    assert "erforderlich" in message.lower()


@pytest.mark.django_db
def test_admin_create_station_rejects_overlong_name(auth_client, scientist):
    # The serializer must keep the model's max_length guard so an oversized value
    # is a 400, not a database error on save.
    response = auth_client.post(STATIONS_URL, _station_payload(name="A" * 300), format="json")

    assert response.status_code == 400
    assert "name" in response.json()


@pytest.mark.django_db
def test_admin_create_station_derives_distinct_handles_for_same_name(
    auth_client, scientist, organization
):
    first = auth_client.post(STATIONS_URL, _station_payload(name="Auwald"), format="json")
    second = auth_client.post(STATIONS_URL, _station_payload(name="Auwald"), format="json")

    assert first.status_code == 201 and second.status_code == 201
    assert first.json()["handle"] != second.json()["handle"]


@pytest.mark.django_db
def test_admin_create_station_ignores_client_supplied_handle(auth_client, scientist, organization):
    response = auth_client.post(
        STATIONS_URL, _station_payload(handle="CLIENTPICKED"), format="json"
    )

    assert response.status_code == 201, response.json()
    assert response.json()["handle"] != "CLIENTPICKED"
    assert not RingingStation.objects.filter(handle="CLIENTPICKED").exists()


@pytest.mark.django_db
def test_admin_create_station_forced_into_own_org_despite_foreign_org_id(
    auth_client, scientist, organization, organization_b
):
    response = auth_client.post(
        STATIONS_URL,
        _station_payload(organization_id=organization_b.handle),
        format="json",
    )

    assert response.status_code == 201, response.json()
    station = RingingStation.objects.get(handle=response.json()["handle"])
    assert station.organization_id == organization.handle


def _list_handles(response):
    """Handles in a (paginated) Station list response, order-independent."""
    body = response.json()
    results = body["results"] if isinstance(body, dict) else body
    return {row["handle"] for row in results}


@pytest.mark.django_db
def test_archiving_hides_station_from_default_list_but_include_archived_shows_it(
    auth_client, scientist, ringing_station
):
    detail = f"{STATIONS_URL}{ringing_station.handle}/"

    assert ringing_station.handle in _list_handles(auth_client.get(STATIONS_URL))

    archive = auth_client.patch(detail, {"is_active": False}, format="json")
    assert archive.status_code == 200, archive.json()
    ringing_station.refresh_from_db()
    assert ringing_station.is_active is False

    # Hidden from the default list/picker …
    assert ringing_station.handle not in _list_handles(auth_client.get(STATIONS_URL))
    # … but visible when the management list opts in with include_archived=true.
    assert ringing_station.handle in _list_handles(
        auth_client.get(f"{STATIONS_URL}?include_archived=true")
    )


@pytest.mark.django_db
def test_unarchiving_restores_station_to_default_list(auth_client, scientist, ringing_station):
    detail = f"{STATIONS_URL}{ringing_station.handle}/"
    auth_client.patch(detail, {"is_active": False}, format="json")
    assert ringing_station.handle not in _list_handles(auth_client.get(STATIONS_URL))

    restore = auth_client.patch(detail, {"is_active": True}, format="json")
    assert restore.status_code == 200, restore.json()
    assert ringing_station.handle in _list_handles(auth_client.get(STATIONS_URL))


@pytest.mark.django_db
def test_archiving_preserves_existing_captures(auth_client, scientist, ringing_station, data_entry):
    detail = f"{STATIONS_URL}{ringing_station.handle}/"
    archive = auth_client.patch(detail, {"is_active": False}, format="json")

    assert archive.status_code == 200, archive.json()
    # The Station and its capture both survive archiving.
    assert RingingStation.objects.filter(handle=ringing_station.handle).exists()
    assert DataEntry.objects.filter(pk=data_entry.pk).exists()


@pytest.mark.django_db
def test_delete_refused_with_captures_returns_409_german(
    auth_client, scientist, ringing_station, data_entry
):
    response = auth_client.delete(f"{STATIONS_URL}{ringing_station.handle}/")

    assert response.status_code == 409
    detail = response.json()["detail"]
    assert "Fänge" in detail and "archiv" in detail.lower()
    # The captures are never orphaned — the Station stays.
    assert RingingStation.objects.filter(handle=ringing_station.handle).exists()
    assert DataEntry.objects.filter(pk=data_entry.pk).exists()


@pytest.mark.django_db
def test_mitglied_cannot_create_station(mitglied_client, mitglied_scientist, organization):
    response = mitglied_client.post(STATIONS_URL, _station_payload(), format="json")
    assert response.status_code == 403
    assert not RingingStation.objects.exists()


@pytest.mark.django_db
def test_mitglied_cannot_edit_or_delete_station(
    mitglied_client, mitglied_scientist, ringing_station
):
    detail = f"{STATIONS_URL}{ringing_station.handle}/"

    assert mitglied_client.patch(detail, {"name": "X"}, format="json").status_code == 403
    assert mitglied_client.delete(detail).status_code == 403
    assert RingingStation.objects.filter(handle=ringing_station.handle).exists()


@pytest.mark.django_db
def test_admin_can_create_edit_and_delete_station(auth_client, scientist, organization):
    create = auth_client.post(STATIONS_URL, _station_payload(), format="json")
    assert create.status_code == 201, create.json()
    handle = create.json()["handle"]

    detail = f"{STATIONS_URL}{handle}/"
    edit = auth_client.patch(detail, {"name": "Umbenannt"}, format="json")
    assert edit.status_code == 200, edit.json()
    assert RingingStation.objects.get(handle=handle).name == "Umbenannt"

    # No captures reference this Station, so a hard delete is allowed.
    delete = auth_client.delete(detail)
    assert delete.status_code == 204
    assert not RingingStation.objects.filter(handle=handle).exists()


@pytest.mark.django_db
def test_admin_cannot_manage_another_tenants_station(auth_client, scientist, ringing_station_b):
    # Reads are tenant-scoped (issue #74), so another tenant's Station is absent
    # from the queryset — a cross-tenant write is a 404 (the row is invisible),
    # not a 403.
    detail = f"{STATIONS_URL}{ringing_station_b.handle}/"

    assert auth_client.patch(detail, {"name": "X"}, format="json").status_code == 404
    assert auth_client.delete(detail).status_code == 404
    assert RingingStation.objects.filter(handle=ringing_station_b.handle).exists()


# --- Organisation edit: Admin-only, scoped to the actor's own Organisation ----


@pytest.mark.django_db
def test_mitglied_cannot_edit_organisation(mitglied_client, mitglied_scientist, organization):
    response = mitglied_client.patch(
        f"{ORGS_URL}{organization.handle}/", {"name": "Gekapert"}, format="json"
    )
    assert response.status_code == 403
    organization.refresh_from_db()
    assert organization.name == "Test Org"


@pytest.mark.django_db
def test_admin_can_edit_organisation(auth_client, scientist, organization):
    response = auth_client.patch(
        f"{ORGS_URL}{organization.handle}/", {"name": "Neuer Name"}, format="json"
    )
    assert response.status_code == 200, response.json()
    organization.refresh_from_db()
    assert organization.name == "Neuer Name"


@pytest.mark.django_db
def test_admin_cannot_edit_another_tenants_organisation(auth_client, scientist, organization_b):
    # Organisations are scoped to the requester's Mitgliedschaften (issue #74), so
    # another tenant's Organisation is invisible — a cross-tenant edit is a 404.
    response = auth_client.patch(
        f"{ORGS_URL}{organization_b.handle}/", {"name": "X"}, format="json"
    )
    assert response.status_code == 404
    organization_b.refresh_from_db()
    assert organization_b.name == "Second Org"


# --- Beringer deletion: Admin-only, out-of-band, reassigns to the fallback ----


@pytest.mark.django_db
def test_beringer_delete_is_not_exposed_on_the_api(
    auth_client, scientist, mitglied_client, mitglied_scientist
):
    """Beringer deletion is an Admin operation performed via the Django admin, not
    the public API (ADR 0003) — /scientists/ stays create/read-only for everyone,
    Admin and Mitglied alike, so neither can delete a Beringer over the API."""
    detail = f"{SCIENTISTS_URL}{scientist.id}/"

    assert mitglied_client.delete(detail).status_code == 405
    assert auth_client.delete(detail).status_code == 405
    assert Scientist.objects.filter(id=scientist.id).exists()


@pytest.mark.django_db
def test_admin_deleting_beringer_reassigns_captures_to_fallback(data_entry, organization):
    """Deleting a Beringer (Admin, via the Django admin) never loses captures —
    they are reassigned to the reserved "Gelöschter Nutzer" fallback and stay
    within their Organisation (ADR 0003)."""
    beringer = data_entry.staff

    beringer.delete()

    data_entry.refresh_from_db()
    assert data_entry.staff.handle == FALLBACK_BERINGER_HANDLE
    assert data_entry.organization == organization
    assert not Scientist.objects.filter(id=beringer.id).exists()
