"""Zentrale (Central) reference data, /centrals/ lookup, EURING seed + AUW
backfill (issue #228, ADR 0019).

The Zentrale is global reference data like Species — explicitly never
tenant-scoped. These tests exercise it through the public DRF HTTP API and,
for the data migration, the way the repo tests its other data migrations
(import the migration module and call its function — prior art: test_cutover,
test_rings backfill).
"""

import importlib

import pytest
from django.apps import apps as global_apps

from birds.models import Central, Project, Ring

LIST_URL = "/api/birds/centrals/"


# --- EURING seed (prior art: test_cutover seed) -----------------------------


@pytest.mark.django_db
def test_seed_includes_auw_with_name_and_country(db):
    """The home scheme AUW is seeded with its centre name and country (US 28)."""
    auw = Central.objects.get(scheme_code="AUW")
    assert auw.name == "Österreichische Vogelwarte"
    assert auw.country == "Austria"


@pytest.mark.django_db
def test_seed_includes_slovak_bratislava_scheme(db):
    """SKB (the Slovak Bratislava scheme, used by later slices for the Slovak
    'S' ring) is present in the seeded register."""
    skb = Central.objects.get(scheme_code="SKB")
    assert skb.country == "Slovakia"


@pytest.mark.django_db
def test_seed_is_the_comprehensive_euring_list(db):
    """The full published EURING scheme list (~100 rows) is seeded — a
    comprehensive register, not just the two named schemes (US 28)."""
    assert Central.objects.count() >= 50


@pytest.mark.django_db
def test_scheme_code_is_unique(db):
    """scheme_code is the unique key — a re-seed refreshes, never duplicates."""
    assert Central.objects.filter(scheme_code="AUW").count() == 1
    assert Central.objects.filter(scheme_code="SKB").count() == 1


# --- /centrals/ list + search + auth (prior art: test_species/test_lookups) --


@pytest.mark.django_db
def test_centrals_list_requires_authentication(api_client):
    """Like every endpoint, the lookup requires authentication."""
    response = api_client.get(LIST_URL)
    assert response.status_code in (401, 403)


@pytest.mark.django_db
def test_centrals_list_returns_the_register(auth_client, membership):
    response = auth_client.get(LIST_URL)
    assert response.status_code == 200
    assert response.json()["count"] >= 50


@pytest.mark.django_db
def test_centrals_search_by_scheme_code(auth_client, membership):
    codes = {
        row["scheme_code"] for row in auth_client.get(LIST_URL, {"search": "SKB"}).json()["results"]
    }
    assert "SKB" in codes


@pytest.mark.django_db
def test_centrals_search_by_name(auth_client, membership):
    codes = {
        row["scheme_code"]
        for row in auth_client.get(LIST_URL, {"search": "Bratislava"}).json()["results"]
    }
    assert "SKB" in codes


@pytest.mark.django_db
def test_centrals_search_by_country(auth_client, membership):
    codes = {
        row["scheme_code"]
        for row in auth_client.get(LIST_URL, {"search": "Slovakia"}).json()["results"]
    }
    assert "SKB" in codes


@pytest.mark.django_db
def test_centrals_search_returns_scheme_code_and_name(auth_client, membership):
    row = next(
        r
        for r in auth_client.get(LIST_URL, {"search": "AUW"}).json()["results"]
        if r["scheme_code"] == "AUW"
    )
    assert row["name"] == "Österreichische Vogelwarte"
    assert row["country"] == "Austria"


@pytest.mark.django_db
def test_centrals_endpoint_is_read_only(auth_client, membership):
    response = auth_client.post(
        LIST_URL, {"scheme_code": "XXX", "name": "X", "country": "X"}, format="json"
    )
    assert response.status_code == 405


@pytest.mark.django_db
def test_centrals_are_global_across_tenants(auth_client, auth_client_b, membership, scientist_b):
    """The Zentrale is global reference data — explicitly NOT tenant-scoped
    (like Species). A Mitglied of tenant A and a Mitglied of tenant B get the
    same register."""
    a = auth_client.get(LIST_URL, {"search": "AUW"}).json()["results"]
    b = auth_client_b.get(LIST_URL, {"search": "AUW"}).json()["results"]
    assert [r["scheme_code"] for r in a] == [r["scheme_code"] for r in b]
    assert "AUW" in {r["scheme_code"] for r in a}


# --- AUW backfill (prior art: test_rings backfill migration) -----------------


@pytest.mark.django_db
def test_backfill_assigns_auw_to_central_less_ring_and_project(organization, scientist):
    """The data migration attributes every pre-field (Zentrale-less) Ring and
    Projekt — across all tenants — to AUW without data loss (US 27, 29). The
    ORM sets AUW on save(), so the pre-field NULL state is forced first."""
    backfill = importlib.import_module("birds.migrations.0057_backfill_central_to_auw")

    ring = Ring.objects.create(number="0042", size=Ring.RingSizes.V, organization=organization)
    project = Project.objects.create(title="Legacy", organization=organization)
    Ring.objects.filter(pk=ring.pk).update(central=None)
    Project.objects.filter(pk=project.pk).update(central=None)

    backfill.backfill_central_to_auw(global_apps, None)

    ring.refresh_from_db()
    project.refresh_from_db()
    auw = Central.objects.get(scheme_code="AUW")
    assert ring.central == auw
    assert project.central == auw


@pytest.mark.django_db
def test_new_projekt_defaults_to_auw(organization):
    """A new Projekt defaults to the AUW Zentrale (US 29)."""
    project = Project.objects.create(title="Fresh", organization=organization)
    assert project.central.scheme_code == "AUW"


# --- Capture writes unchanged (rings under AUW; strict Austrian sizes) -------


@pytest.mark.django_db
def test_capture_get_returns_ring_zentrale_nested(
    auth_client, scientist, species, ringing_station, project
):
    """GET on a capture returns the ring's Zentrale nested (scheme_code + name)
    so entry details can show it (US 19, backend)."""
    create = auth_client.post(
        "/api/birds/data-entries/",
        {
            "species_id": str(species.id),
            "staff_id": scientist.id,
            "ringing_station_id": ringing_station.handle,
            "ring_number": "0042",
            "ring_size": "V",
            "project_id": str(project.id),
            "date_time": "2026-03-01T12:00:00Z",
        },
        format="json",
    )
    assert create.status_code == 201, create.json()

    detail = auth_client.get(f"/api/birds/data-entries/{create.json()['id']}/").json()
    central = detail["ring"]["central"]
    assert central["scheme_code"] == "AUW"
    assert central["name"] == "Österreichische Vogelwarte"


@pytest.mark.django_db
def test_capture_write_creates_ring_under_auw(
    auth_client, scientist, species, ringing_station, project
):
    """Ring creation on the write path uses the Projekt-Zentrale — today always
    AUW — so capture writes behave exactly as before."""
    from birds.models import DataEntry

    create = auth_client.post(
        "/api/birds/data-entries/",
        {
            "species_id": str(species.id),
            "staff_id": scientist.id,
            "ringing_station_id": ringing_station.handle,
            "ring_number": "0043",
            "ring_size": "V",
            "project_id": str(project.id),
            "date_time": "2026-03-01T12:00:00Z",
        },
        format="json",
    )
    assert create.status_code == 201, create.json()

    entry = DataEntry.objects.get(id=create.json()["id"])
    assert entry.ring.central.scheme_code == "AUW"


@pytest.mark.django_db
def test_capture_write_still_rejects_non_austrian_size(
    auth_client, scientist, species, ringing_station, project
):
    """Strict Austrian sizes are unchanged: a size outside the Austrian scheme
    is refused with a 400, exactly as before."""
    create = auth_client.post(
        "/api/birds/data-entries/",
        {
            "species_id": str(species.id),
            "staff_id": scientist.id,
            "ringing_station_id": ringing_station.handle,
            "ring_number": "0044",
            "ring_size": "ZZ",
            "project_id": str(project.id),
            "date_time": "2026-03-01T12:00:00Z",
        },
        format="json",
    )
    assert create.status_code == 400
    assert "ring_size" in create.json()
