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
def test_new_project_attaches_to_active_organisation(auth_client, scientist, organization):
    """A newly created Projekt attaches to the requester's active Organisation,
    server-side — no client-supplied organization_id needed (issue #74)."""
    response = auth_client.post(LIST_URL, {"title": "P", "description": ""}, format="json")

    assert response.status_code == 201, response.json()
    assert Project.objects.get(title="P").organization == organization


@pytest.mark.django_db
def test_create_project_ignores_client_supplied_foreign_organisation(
    auth_client, scientist, organization
):
    """The owning Organisation is server-authoritative: a client cannot plant a
    Projekt in another tenant by supplying a foreign organization_id (issue #74)."""
    other = Organization.objects.create(handle="ORG2", name="Other Org")
    response = auth_client.post(
        LIST_URL,
        {"title": "P", "organization_id": other.handle},
        format="json",
    )

    assert response.status_code == 201, response.json()
    assert Project.objects.get(title="P").organization == organization


@pytest.mark.django_db
def test_create_project_rejected_without_active_organisation(auth_client):
    """Without a Mitgliedschaft there is no active Organisation to own the Projekt,
    so creation is refused (issue #74)."""
    response = auth_client.post(LIST_URL, {"title": "P"}, format="json")

    assert response.status_code == 403
    assert not Project.objects.filter(title="P").exists()


@pytest.mark.django_db
def test_cross_tenant_project_detail_and_write_return_404(auth_client, scientist, project_b):
    """A cross-tenant Projekt is invisible: detail and write both 404 (issue #74)."""
    detail = f"{LIST_URL}{project_b.id}/"

    assert auth_client.get(detail).status_code == 404
    assert auth_client.patch(detail, {"title": "hacked"}, format="json").status_code == 404
    assert auth_client.delete(detail).status_code == 404
    project_b.refresh_from_db()
    assert project_b.title == "Project B"


@pytest.mark.django_db
def test_two_tenant_project_isolation_has_no_leakage(
    auth_client, auth_client_b, project, project_b
):
    """Two complete tenants: a Mitglied of A sees only A's Projekte and a Mitglied
    of B sees only B's — no A↔B leakage (issue #74)."""
    a_ids = [row["id"] for row in auth_client.get(LIST_URL).json()["results"]]
    b_ids = [row["id"] for row in auth_client_b.get(LIST_URL).json()["results"]]

    assert a_ids == [str(project.id)]
    assert b_ids == [str(project_b.id)]


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


# --- Projekttyp: descriptive per-Projekt programme classification -----------
# Issue #335, PRD #332, ADR 0023. Projekttyp is internal, descriptive metadata:
# writable only by an Admin, optional (unset reads as Sonstiges), never exported
# and gating no capture field.


@pytest.mark.django_db
def test_create_project_defaults_projekttyp_to_sonstiges(auth_client, scientist, organization):
    """A Projekt created without a Projekttyp resolves to Sonstiges (the default)."""
    response = auth_client.post(LIST_URL, {"title": "P"}, format="json")

    assert response.status_code == 201, response.json()
    assert response.json()["projekttyp"] == Project.Projekttyp.SONSTIGES
    assert Project.objects.get(title="P").projekttyp == Project.Projekttyp.SONSTIGES


@pytest.mark.django_db
def test_create_project_with_projekttyp_round_trips(auth_client, scientist, organization):
    """An explicit Projekttyp on create is persisted and echoed back."""
    response = auth_client.post(
        LIST_URL,
        {"title": "P", "projekttyp": Project.Projekttyp.NESTLINGSBERINGUNG},
        format="json",
    )

    assert response.status_code == 201, response.json()
    assert response.json()["projekttyp"] == Project.Projekttyp.NESTLINGSBERINGUNG
    assert Project.objects.get(title="P").projekttyp == Project.Projekttyp.NESTLINGSBERINGUNG


@pytest.mark.django_db
def test_update_project_projekttyp_round_trips(auth_client, project):
    """An Admin can change a Projekt's Projekttyp; the new value round-trips."""
    assert project.projekttyp == Project.Projekttyp.SONSTIGES

    response = auth_client.patch(
        f"{LIST_URL}{project.id}/",
        {"projekttyp": Project.Projekttyp.IWM},
        format="json",
    )

    assert response.status_code == 200, response.json()
    assert response.json()["projekttyp"] == Project.Projekttyp.IWM
    project.refresh_from_db()
    assert project.projekttyp == Project.Projekttyp.IWM


@pytest.mark.django_db
def test_update_without_projekttyp_leaves_default_untouched(auth_client, project):
    """Editing a Projekt without naming a Projekttyp keeps it at Sonstiges — an
    unset Projekttyp still reads as Sonstiges after an unrelated edit."""
    response = auth_client.patch(f"{LIST_URL}{project.id}/", {"title": "Renamed"}, format="json")

    assert response.status_code == 200, response.json()
    project.refresh_from_db()
    assert project.projekttyp == Project.Projekttyp.SONSTIGES


@pytest.mark.django_db
def test_mitglied_cannot_set_projekttyp(mitglied_client, mitglied_scientist, project):
    """Projekttyp rides the Admin-only write rule: a plain Mitglied cannot change
    it (the whole Projekt write is refused with a 403)."""
    response = mitglied_client.patch(
        f"{LIST_URL}{project.id}/",
        {"projekttyp": Project.Projekttyp.IWM},
        format="json",
    )

    assert response.status_code == 403
    project.refresh_from_db()
    assert project.projekttyp == Project.Projekttyp.SONSTIGES


# --- Netzfelder anzeigen: per-Projekt net-block visibility toggle -------------
# Issue #336, PRD #332, ADR 0023. ``show_net_fields`` is an independent per-Projekt
# boolean (default on, parallel to ``show_optional_fields``, NOT derived from
# Projekttyp): when off the capture form hides the whole net block. Admin-only to
# write; hiding is display-only and never touches stored/exported net data.


@pytest.mark.django_db
def test_create_project_defaults_show_net_fields_to_true(auth_client, scientist, organization):
    """A Projekt created without naming show_net_fields keeps the net fields on."""
    response = auth_client.post(LIST_URL, {"title": "P"}, format="json")

    assert response.status_code == 201, response.json()
    assert response.json()["show_net_fields"] is True
    assert Project.objects.get(title="P").show_net_fields is True


@pytest.mark.django_db
def test_create_project_with_show_net_fields_false_round_trips(
    auth_client, scientist, organization
):
    """An explicit show_net_fields=False on create is persisted and echoed back."""
    response = auth_client.post(
        LIST_URL,
        {"title": "P", "show_net_fields": False},
        format="json",
    )

    assert response.status_code == 201, response.json()
    assert response.json()["show_net_fields"] is False
    assert Project.objects.get(title="P").show_net_fields is False


@pytest.mark.django_db
def test_update_project_show_net_fields_round_trips(auth_client, project):
    """An Admin can hide the net block on an existing Projekt; the value round-trips."""
    assert project.show_net_fields is True

    response = auth_client.patch(
        f"{LIST_URL}{project.id}/",
        {"show_net_fields": False},
        format="json",
    )

    assert response.status_code == 200, response.json()
    assert response.json()["show_net_fields"] is False
    project.refresh_from_db()
    assert project.show_net_fields is False


@pytest.mark.django_db
def test_mitglied_cannot_set_show_net_fields(mitglied_client, mitglied_scientist, project):
    """show_net_fields rides the Admin-only write rule: a plain Mitglied cannot
    change it (the whole Projekt write is refused with a 403)."""
    response = mitglied_client.patch(
        f"{LIST_URL}{project.id}/",
        {"show_net_fields": False},
        format="json",
    )

    assert response.status_code == 403
    project.refresh_from_db()
    assert project.show_net_fields is True


# --- Saison window: optional per-Projekt recurring month window --------------
# ADR 0029, issue #373. Two nullable month fields (1–12) on the Projekt, set
# manually per Projekt (no Projekttyp coupling/seeding). Both null ⇒ no season
# configured. Admin-only to write, like the rest of Projektverwaltung.


@pytest.mark.django_db
def test_project_defaults_saison_window_to_null(auth_client, scientist, project):
    """A freshly created Projekt has no season configured — both month fields
    are null and echoed as null on GET."""
    response = auth_client.get(f"{LIST_URL}{project.id}/")

    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["saison_start_month"] is None
    assert body["saison_end_month"] is None


@pytest.mark.django_db
def test_admin_can_set_saison_window_and_it_round_trips(auth_client, project):
    """An Admin sets the recurring month window (Nov–März) in the Projekt
    settings; it persists and round-trips on the read shape."""
    response = auth_client.patch(
        f"{LIST_URL}{project.id}/",
        {"saison_start_month": 11, "saison_end_month": 3},
        format="json",
    )

    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["saison_start_month"] == 11
    assert body["saison_end_month"] == 3
    project.refresh_from_db()
    assert project.saison_start_month == 11
    assert project.saison_end_month == 3


@pytest.mark.django_db
def test_saison_window_rejects_out_of_range_month(auth_client, project):
    """Months are constrained to 1–12; a 13 is a 400, not a silently-stored value."""
    response = auth_client.patch(
        f"{LIST_URL}{project.id}/",
        {"saison_start_month": 13, "saison_end_month": 3},
        format="json",
    )

    assert response.status_code == 400
    project.refresh_from_db()
    assert project.saison_start_month is None


@pytest.mark.django_db
def test_mitglied_cannot_set_saison_window(mitglied_client, mitglied_scientist, project):
    """The Saison window rides the Admin-only write rule: a plain Mitglied cannot
    set it (the whole Projekt write is refused with a 403)."""
    response = mitglied_client.patch(
        f"{LIST_URL}{project.id}/",
        {"saison_start_month": 7, "saison_end_month": 10},
        format="json",
    )

    assert response.status_code == 403
    project.refresh_from_db()
    assert project.saison_start_month is None
    assert project.saison_end_month is None
