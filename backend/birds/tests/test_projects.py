from datetime import time

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

from birds.models import Organization, Project, RingingStation

LIST_URL = "/api/birds/projects/"

# The Optionale-Felder migration (ADR 0035, issue #430) and the state right before
# it — used by the migration test that proves the two retired visibility booleans
# fold into the opt-out list in all four combinations.
_MIGRATION_BEFORE_OPTIONAL_FIELDS = "0071_unmigratablepayload"
_MIGRATION_OPTIONAL_FIELDS = "0072_project_hidden_optional_fields"


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


# --- Optionale Felder: one per-Projekt opt-out list ---------------------------
# Issue #430, PRD #426, ADR 0035. ``hidden_optional_fields`` is ONE list over a
# fixed seven-entry vocabulary (Brutfleck, CPL+, Hungerstreifen, Parasit, Kerbe F2,
# Innenfuß, Netz-Block) replacing the retired ``show_optional_fields`` /
# ``show_net_fields`` booleans. Stored is what was switched OFF: an empty list means
# every optional field is visible, so a Projekt nobody configured shows everything.
# Admin-only to write; hiding is display-only and never touches stored/exported data.


@pytest.mark.django_db
def test_create_project_defaults_hidden_optional_fields_to_empty(
    auth_client, scientist, organization
):
    """A Projekt created without naming the setting hides nothing — the opt-out list
    starts empty, so every optional field is visible (doing nothing breaks nothing)."""
    response = auth_client.post(LIST_URL, {"title": "P"}, format="json")

    assert response.status_code == 201, response.json()
    assert response.json()["hidden_optional_fields"] == []
    assert Project.objects.get(title="P").hidden_optional_fields == []


@pytest.mark.django_db
def test_create_project_with_hidden_optional_fields_round_trips(
    auth_client, scientist, organization
):
    """An explicit opt-out list on create is persisted and echoed back."""
    response = auth_client.post(
        LIST_URL,
        {"title": "P", "hidden_optional_fields": ["hunger_stripes", "net_block"]},
        format="json",
    )

    assert response.status_code == 201, response.json()
    assert response.json()["hidden_optional_fields"] == ["hunger_stripes", "net_block"]
    assert Project.objects.get(title="P").hidden_optional_fields == ["hunger_stripes", "net_block"]


@pytest.mark.django_db
def test_update_project_hidden_optional_fields_round_trips(auth_client, project):
    """An Admin can switch optional fields off on an existing Projekt; the list
    round-trips."""
    assert project.hidden_optional_fields == []

    response = auth_client.patch(
        f"{LIST_URL}{project.id}/",
        {"hidden_optional_fields": ["cpl_plus"]},
        format="json",
    )

    assert response.status_code == 200, response.json()
    assert response.json()["hidden_optional_fields"] == ["cpl_plus"]
    project.refresh_from_db()
    assert project.hidden_optional_fields == ["cpl_plus"]


@pytest.mark.django_db
def test_optional_fields_switch_independently_of_one_another(auth_client, project):
    """The whole point of ADR 0035: keeping Parasit no longer forces Hungerstreifen,
    CPL+, Kerbe F2 and Innenfuß along with it. Switching four of the six off leaves
    the other two — Brutfleck and Parasit — visible."""
    response = auth_client.patch(
        f"{LIST_URL}{project.id}/",
        {"hidden_optional_fields": ["cpl_plus", "hunger_stripes", "notch_f2", "inner_foot"]},
        format="json",
    )

    assert response.status_code == 200, response.json()
    hidden = response.json()["hidden_optional_fields"]
    assert "brood_patch" not in hidden
    assert "parasit" not in hidden


@pytest.mark.django_db
def test_the_vocabulary_is_the_seven_entries_with_the_net_block_as_one(
    auth_client, scientist, organization
):
    """Exactly seven keys are accepted, and the Netz-Block is ONE of them: Netznr.,
    Netzfach and Flugrichtung are never switchable individually."""
    response = auth_client.post(
        LIST_URL,
        {
            "title": "P",
            "hidden_optional_fields": [
                "brood_patch",
                "cpl_plus",
                "hunger_stripes",
                "parasit",
                "notch_f2",
                "inner_foot",
                "net_block",
            ],
        },
        format="json",
    )

    assert response.status_code == 201, response.json()
    assert len(response.json()["hidden_optional_fields"]) == 7

    for single_net_field in ("net_location", "net_height", "net_direction"):
        refused = auth_client.post(
            LIST_URL,
            {"title": "Q", "hidden_optional_fields": [single_net_field]},
            format="json",
        )
        assert refused.status_code == 400, refused.json()


@pytest.mark.django_db
def test_unknown_optional_field_key_is_rejected(auth_client, scientist, organization):
    """A typo must not pass silently as „nothing hidden": an unknown key is a 400
    and nothing is created."""
    response = auth_client.post(
        LIST_URL,
        {"title": "P", "hidden_optional_fields": ["hungerstriefen"]},
        format="json",
    )

    assert response.status_code == 400, response.json()
    assert "hidden_optional_fields" in response.json()
    assert not Project.objects.filter(title="P").exists()


@pytest.mark.django_db
def test_core_fields_are_not_switchable(auth_client, scientist, organization):
    """Gewicht, Flügellänge and the rest of the Kern are outside the vocabulary, so
    no Projekt can switch them off and quietly file a Datenmeldung with an empty
    mandatory column."""
    for core_field in ("weight_gram", "wing_span", "ring_number", "age_class"):
        response = auth_client.post(
            LIST_URL,
            {"title": "P", "hidden_optional_fields": [core_field]},
            format="json",
        )
        assert response.status_code == 400, response.json()


@pytest.mark.django_db
def test_duplicate_optional_field_keys_collapse(auth_client, project):
    """A key named twice is one switched-off field, not two."""
    response = auth_client.patch(
        f"{LIST_URL}{project.id}/",
        {"hidden_optional_fields": ["parasit", "parasit", "net_block"]},
        format="json",
    )

    assert response.status_code == 200, response.json()
    project.refresh_from_db()
    assert sorted(project.hidden_optional_fields) == ["net_block", "parasit"]


@pytest.mark.django_db
def test_optional_field_order_is_irrelevant(auth_client, project, organization, scientist):
    """The list is a set of switched-off fields, not a sequence: two Projekte given
    the same keys in different orders end up configured identically."""
    other = Project.objects.create(title="Zweitprojekt", organization=organization)
    other.scientists.add(scientist)

    first = auth_client.patch(
        f"{LIST_URL}{project.id}/",
        {"hidden_optional_fields": ["net_block", "brood_patch"]},
        format="json",
    )
    second = auth_client.patch(
        f"{LIST_URL}{other.id}/",
        {"hidden_optional_fields": ["brood_patch", "net_block"]},
        format="json",
    )

    assert first.status_code == 200, first.json()
    assert second.status_code == 200, second.json()
    assert first.json()["hidden_optional_fields"] == second.json()["hidden_optional_fields"]


@pytest.mark.django_db
def test_mitglied_cannot_set_hidden_optional_fields(mitglied_client, mitglied_scientist, project):
    """The setting rides the Admin-only write rule: a plain Mitglied cannot
    reconfigure the mask out from under their colleagues (403)."""
    response = mitglied_client.patch(
        f"{LIST_URL}{project.id}/",
        {"hidden_optional_fields": ["parasit"]},
        format="json",
    )

    assert response.status_code == 403
    project.refresh_from_db()
    assert project.hidden_optional_fields == []


@pytest.mark.django_db
def test_retired_visibility_booleans_are_gone_from_the_payload(auth_client, project):
    """Hard cut (ADR 0035): both booleans leave the payload with the model, without
    a derived pass-through across the offline window."""
    response = auth_client.get(f"{LIST_URL}{project.id}/")

    assert response.status_code == 200, response.json()
    body = response.json()
    assert "show_optional_fields" not in body
    assert "show_net_fields" not in body
    assert "hidden_optional_fields" in body


# --- Migration: the two booleans fold into the opt-out list -------------------
# ADR 0035, all four combinations. ``show_optional_fields=False`` ⇒ the six optional
# keys; ``show_net_fields=False`` ⇒ the Netz key; both ⇒ all seven; neither ⇒ an
# empty list, so a Projekt shows after the update exactly what it showed before.


@pytest.mark.django_db(transaction=True)
def test_migration_folds_both_booleans_into_the_opt_out_list():
    """A Projekt with the optional block off ends up hiding exactly the six optional
    keys, one with the net block off exactly the Netz key, one with both all seven,
    and an untouched Projekt an empty list."""
    executor = MigrationExecutor(connection)
    try:
        executor.migrate([("birds", _MIGRATION_BEFORE_OPTIONAL_FIELDS)])
        old_apps = executor.loader.project_state(
            [("birds", _MIGRATION_BEFORE_OPTIONAL_FIELDS)]
        ).apps

        Organization = old_apps.get_model("birds", "Organization")
        Historic = old_apps.get_model("birds", "Project")

        org = Organization.objects.create(handle="OPTORG", name="Opt Org", country="AT")
        everything = Historic.objects.create(
            title="Alles an",
            organization=org,
            show_optional_fields=True,
            show_net_fields=True,
        )
        no_optional = Historic.objects.create(
            title="Optionalblock aus",
            organization=org,
            show_optional_fields=False,
            show_net_fields=True,
        )
        no_net = Historic.objects.create(
            title="Netzblock aus",
            organization=org,
            show_optional_fields=True,
            show_net_fields=False,
        )
        nothing = Historic.objects.create(
            title="Beides aus",
            organization=org,
            show_optional_fields=False,
            show_net_fields=False,
        )

        executor.loader.build_graph()
        executor.migrate([("birds", _MIGRATION_OPTIONAL_FIELDS)])
        new_apps = executor.loader.project_state([("birds", _MIGRATION_OPTIONAL_FIELDS)]).apps
        Migrated = new_apps.get_model("birds", "Project")

        def hidden(pk):
            return sorted(Migrated.objects.get(pk=pk).hidden_optional_fields)

        assert hidden(everything.pk) == []
        assert hidden(no_optional.pk) == [
            "brood_patch",
            "cpl_plus",
            "hunger_stripes",
            "inner_foot",
            "notch_f2",
            "parasit",
        ]
        assert hidden(no_net.pk) == ["net_block"]
        assert hidden(nothing.pk) == [
            "brood_patch",
            "cpl_plus",
            "hunger_stripes",
            "inner_foot",
            "net_block",
            "notch_f2",
            "parasit",
        ]
    finally:
        executor.loader.build_graph()
        executor.migrate(executor.loader.graph.leaf_nodes())


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


# --- Wochengrenze: Wochentag + Uhrzeit pro Projekt ---------------------------
# ADR 0036, issue #431. The instant a Projekt's Beringungswoche turns over, e.g.
# Samstag 12:00. Deliberately UNLIKE the nullable Saison window: both fields are
# non-nullable with a default (Montag 00:00), so „unkonfiguriert" is not a state of
# its own and the „Diese Woche" preset can never disappear. Admin-only to write,
# like the rest of Projektverwaltung.


@pytest.mark.django_db
def test_project_defaults_the_wochengrenze_to_montag_midnight(auth_client, scientist, project):
    """A freshly created Projekt already carries a Wochengrenze — Montag 00:00 —
    rather than an „unset" state the dashboard would have to interpret."""
    response = auth_client.get(f"{LIST_URL}{project.id}/")

    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["wochengrenze_weekday"] == 0
    assert body["wochengrenze_time"] == "00:00:00"


@pytest.mark.django_db
def test_admin_can_set_the_wochengrenze_and_it_round_trips(auth_client, project):
    """An Admin sets the Beringungsrhythmus (Samstag 12:00); it persists and
    round-trips on the read shape."""
    response = auth_client.patch(
        f"{LIST_URL}{project.id}/",
        {"wochengrenze_weekday": 5, "wochengrenze_time": "12:00"},
        format="json",
    )

    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["wochengrenze_weekday"] == 5
    assert body["wochengrenze_time"] == "12:00:00"
    project.refresh_from_db()
    assert project.wochengrenze_weekday == 5
    assert project.wochengrenze_time == time(12, 0)


@pytest.mark.django_db
def test_wochengrenze_rejects_a_weekday_outside_the_week(auth_client, project):
    """The Wochentag is the seven-value vocabulary (Montag = 0 … Sonntag = 6); a 7
    is a 400, not a silently-stored value that resolves to nothing."""
    response = auth_client.patch(
        f"{LIST_URL}{project.id}/",
        {"wochengrenze_weekday": 7},
        format="json",
    )

    assert response.status_code == 400
    project.refresh_from_db()
    assert project.wochengrenze_weekday == 0


@pytest.mark.django_db
def test_wochengrenze_cannot_be_cleared_to_null(auth_client, project):
    """There is no „keine Wochengrenze": null is refused, because the preset must
    mean the same thing on every Projekt."""
    response = auth_client.patch(
        f"{LIST_URL}{project.id}/",
        {"wochengrenze_time": None},
        format="json",
    )

    assert response.status_code == 400
    project.refresh_from_db()
    assert project.wochengrenze_time == time(0, 0)


@pytest.mark.django_db
def test_mitglied_cannot_set_the_wochengrenze(mitglied_client, mitglied_scientist, project):
    """The Wochengrenze rides the Admin-only write rule: a plain Mitglied cannot set
    it (the whole Projekt write is refused with a 403)."""
    response = mitglied_client.patch(
        f"{LIST_URL}{project.id}/",
        {"wochengrenze_weekday": 5, "wochengrenze_time": "12:00"},
        format="json",
    )

    assert response.status_code == 403
    project.refresh_from_db()
    assert project.wochengrenze_weekday == 0
    assert project.wochengrenze_time == time(0, 0)


# --- Mindestens ein Beringer: the min-1 rule lives in the serializer ---------
# Issue #389, PRD #384. „Jedes Projekt braucht mindestens eine:n Beringer:in" was
# a frontend-only rule of the Bearbeiten-Dialog. It now holds server-side too, and
# it is checked against the *effective* Beringer set — the one after ``create()``
# auto-adds the creating Beringer — so a POST that names no ``scientist_ids`` still
# succeeds for a creator who has a Beringer of their own.


@pytest.mark.django_db
def test_create_without_beringer_rejected_when_creator_has_none(auth_client, membership):
    """An Admin *without* a Beringer row of their own (the invited-Admin account
    path) creates nothing the auto-add can fill in, so the effective Beringer set
    stays empty and the create is refused — no silent zero-Beringer Projekt."""
    response = auth_client.post(LIST_URL, {"title": "P", "description": ""}, format="json")

    assert response.status_code == 400, response.json()
    assert "scientist_ids" in response.json()
    assert not Project.objects.filter(title="P").exists()


@pytest.mark.django_db
def test_create_with_explicit_empty_beringer_still_attaches_creator(
    auth_client, scientist, organization
):
    """An explicitly empty ``scientist_ids`` is not a zero-Beringer request: the
    creating Beringer is auto-added, so the effective set is non-empty and the
    create succeeds with the creator on it."""
    response = auth_client.post(LIST_URL, {"title": "P", "scientist_ids": []}, format="json")

    assert response.status_code == 201, response.json()
    assert list(Project.objects.get(title="P").scientists.all()) == [scientist]


@pytest.mark.django_db
def test_update_cannot_clear_the_last_beringer(auth_client, project, scientist):
    """The min-1 rule holds on the Bearbeiten path too: emptying the Beringer of an
    existing Projekt is a 400 (there is no create-time auto-add to fall back on)."""
    response = auth_client.patch(f"{LIST_URL}{project.id}/", {"scientist_ids": []}, format="json")

    assert response.status_code == 400, response.json()
    assert "scientist_ids" in response.json()
    project.refresh_from_db()
    assert list(project.scientists.all()) == [scientist]


@pytest.mark.django_db
def test_update_that_leaves_beringer_untouched_still_passes(auth_client, project):
    """The min-1 rule only fires when the edit names the Beringer: a partial edit
    of an unrelated field keeps whoever is on the Projekt."""
    response = auth_client.patch(f"{LIST_URL}{project.id}/", {"title": "Renamed"}, format="json")

    assert response.status_code == 200, response.json()
    project.refresh_from_db()
    assert project.title == "Renamed"
    assert project.scientists.count() == 1
