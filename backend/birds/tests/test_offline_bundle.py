"""The offline reference bundle (issue #157, PRD #152).

A single GET that hands a device everything it needs to operate offline,
scoped to the requester's active Organisation: the offline species pool
(active Artenliste + Sonderarten + every org-used species, each with a usage
count), org reference data (active Stationen, Beringer, Projekte), the
last-consumed ring number per Projekt + Ringgröße (mirroring
``RingViewSet.next_number``'s consumption rule) and the requester's cached
identity (user, Organisation, Rolle).
"""

from datetime import UTC, datetime

import pytest

from birds.models import (
    FALLBACK_BERINGER_HANDLE,
    DataEntry,
    Mitgliedschaft,
    Ring,
    RingingStation,
    Scientist,
    SpeciesList,
)

BUNDLE_URL = "/api/birds/offline-bundle/"


def _capture(
    *,
    species,
    scientist,
    ringing_station,
    ring_number,
    size=Ring.RingSizes.V,
    status=DataEntry.BirdStatus.FIRST_CATCH,
    project=None,
    created=None,
):
    """Seed a Ring and a DataEntry capturing it (mirrors test_rings.py's
    ``_catch``). ``DataEntry.organization`` is left unset so it falls back to
    the Station's Organisation (``DataEntry.save()``), exactly as it does for a
    capture recorded through the real endpoint."""
    ring = Ring.objects.create(number=ring_number, size=size)
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
    return entry


def _at(day):
    return datetime(2026, 1, day, 12, 0, tzinfo=UTC)


def _species_by_id(payload, species_id):
    return next((row for row in payload["species"] if row["id"] == str(species_id)), None)


@pytest.mark.django_db
def test_bundle_requires_authentication(api_client):
    response = api_client.get(BUNDLE_URL)
    assert response.status_code in (401, 403)


# --- Identity ----------------------------------------------------------------


@pytest.mark.django_db
def test_bundle_reports_cached_identity(auth_client, scientist, organization):
    response = auth_client.get(BUNDLE_URL)
    assert response.status_code == 200
    identity = response.json()["identity"]
    assert identity["username"] == "alice"
    assert identity["handle"] == "ALC"
    assert identity["organization"]["handle"] == organization.handle
    assert identity["rolle"] == Mitgliedschaft.Rolle.ADMIN


@pytest.mark.django_db
def test_bundle_reports_mitglied_rolle(mitglied_client, mitglied_scientist, organization):
    response = mitglied_client.get(BUNDLE_URL)
    assert response.status_code == 200
    identity = response.json()["identity"]
    assert identity["rolle"] == Mitgliedschaft.Rolle.MITGLIED


@pytest.mark.django_db
def test_bundle_without_active_organization_is_empty_not_error(auth_client):
    """No resolvable active Organisation ⇒ an empty bundle (mirrors the other
    org-scoped endpoints — empty, not a 403 or 500)."""
    response = auth_client.get(BUNDLE_URL)
    assert response.status_code == 200
    payload = response.json()
    assert payload["identity"]["organization"] is None
    assert payload["species"] == []
    assert payload["ringing_stations"] == []
    assert payload["scientists"] == []
    assert payload["projects"] == []
    assert payload["last_consumed_ring_numbers"] == []


# --- Species pool --------------------------------------------------------------


@pytest.mark.django_db
def test_bundle_species_pool_includes_active_list_members(
    auth_client, user, scientist, species, organization
):
    sl = SpeciesList.objects.create(name="Mine", user=user, is_active=True)
    sl.species.add(species)

    payload = auth_client.get(BUNDLE_URL).json()
    row = _species_by_id(payload, species.id)
    assert row is not None
    assert row["usage_count"] == 0


@pytest.mark.django_db
def test_bundle_species_pool_omits_species_outside_list_and_unused(
    auth_client, user, scientist, species, species_other, organization
):
    sl = SpeciesList.objects.create(name="Mine", user=user, is_active=True)
    sl.species.add(species)

    payload = auth_client.get(BUNDLE_URL).json()
    assert _species_by_id(payload, species.id) is not None
    assert _species_by_id(payload, species_other.id) is None


@pytest.mark.django_db
def test_bundle_species_pool_always_includes_sonderarten(
    auth_client, user, scientist, sentinel_species, aves_ignota_species, organization
):
    """Sonderarten stay selectable even with no active Artenliste at all."""
    assert not SpeciesList.objects.filter(user=user, is_active=True).exists()

    payload = auth_client.get(BUNDLE_URL).json()
    assert _species_by_id(payload, sentinel_species.id) is not None
    assert _species_by_id(payload, aves_ignota_species.id) is not None


@pytest.mark.django_db
def test_bundle_species_pool_includes_org_used_species_with_usage_count(
    auth_client, scientist, ringing_station, species, species_other, organization
):
    _capture(
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        ring_number="0001",
    )
    _capture(
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        ring_number="0002",
    )

    payload = auth_client.get(BUNDLE_URL).json()
    row = _species_by_id(payload, species.id)
    assert row is not None
    assert row["usage_count"] == 2
    assert _species_by_id(payload, species_other.id) is None


@pytest.mark.django_db
def test_bundle_species_pool_usage_count_is_scoped_to_requester_org(
    auth_client,
    scientist,
    ringing_station,
    species,
    organization,
    scientist_b,
    ringing_station_b,
    organization_b,
):
    """Another Organisation's use of a species neither counts towards this
    Organisation's usage count nor pulls the species into the pool on its own."""
    _capture(
        species=species,
        scientist=scientist_b,
        ringing_station=ringing_station_b,
        ring_number="0900",
    )

    payload = auth_client.get(BUNDLE_URL).json()
    assert _species_by_id(payload, species.id) is None


# --- Org reference data: Stationen, Beringer, Projekte ------------------------


@pytest.mark.django_db
def test_bundle_includes_active_stations_excludes_archived_and_foreign(
    auth_client, scientist, organization, organization_b
):
    archived = RingingStation.objects.create(
        handle="ARCH1", name="Archived", organization=organization, is_active=False
    )
    foreign = RingingStation.objects.create(
        handle="FOR1", name="Foreign", organization=organization_b
    )
    active = RingingStation.objects.create(handle="ACT1", name="Active", organization=organization)

    payload = auth_client.get(BUNDLE_URL).json()
    handles = {row["handle"] for row in payload["ringing_stations"]}
    assert handles == {active.handle}
    assert archived.handle not in handles
    assert foreign.handle not in handles


@pytest.mark.django_db
def test_bundle_includes_own_org_scientists_excludes_fallback_and_foreign(
    auth_client, scientist, organization, no_account_beringer_b
):
    quick_add = Scientist.objects.create(
        first_name="Helfer", last_name="Vor Ort", organization=organization
    )

    payload = auth_client.get(BUNDLE_URL).json()
    handles = {row["handle"] for row in payload["scientists"]}
    assert scientist.handle in handles
    assert quick_add.handle in handles
    assert FALLBACK_BERINGER_HANDLE not in handles
    assert no_account_beringer_b.handle not in handles


@pytest.mark.django_db
def test_bundle_includes_only_requesters_own_projects(auth_client, scientist, project, project_b):
    payload = auth_client.get(BUNDLE_URL).json()
    titles = {row["title"] for row in payload["projects"]}
    assert project.title in titles
    assert project_b.title not in titles


# --- Last-consumed ring number per Projekt + Ringgröße -------------------------


@pytest.mark.django_db
def test_bundle_last_consumed_matches_next_number_source(
    auth_client, species, scientist, ringing_station, project, organization
):
    """The bundle reports the *last consumed* (raw) number, not the incremented
    suggestion — the same fact ``RingViewSet.next_number`` increments by one."""
    _capture(
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        ring_number="0050",
        project=project,
        created=_at(1),
    )
    _capture(
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        ring_number="0042",
        project=project,
        created=_at(2),
    )

    payload = auth_client.get(BUNDLE_URL).json()
    entries = payload["last_consumed_ring_numbers"]
    assert len(entries) == 1
    assert entries[0]["project_id"] == str(project.id)
    assert entries[0]["size"] == Ring.RingSizes.V
    assert entries[0]["number"] == "0042"


@pytest.mark.django_db
def test_bundle_last_consumed_ignores_recaptures(
    auth_client, species, scientist, ringing_station, project, organization
):
    _capture(
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        ring_number="0042",
        project=project,
        created=_at(1),
    )
    _capture(
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        ring_number="900000",
        status=DataEntry.BirdStatus.RE_CATCH,
        project=project,
        created=_at(2),
    )

    payload = auth_client.get(BUNDLE_URL).json()
    entries = payload["last_consumed_ring_numbers"]
    assert len(entries) == 1
    assert entries[0]["number"] == "0042"


@pytest.mark.django_db
def test_bundle_last_consumed_counts_destroyed_ring(
    auth_client, sentinel_species, scientist, ringing_station, project, organization
):
    _capture(
        species=sentinel_species,
        scientist=scientist,
        ringing_station=ringing_station,
        ring_number="0007",
        project=project,
    )

    payload = auth_client.get(BUNDLE_URL).json()
    entries = payload["last_consumed_ring_numbers"]
    assert len(entries) == 1
    assert entries[0]["number"] == "0007"


@pytest.mark.django_db
def test_bundle_last_consumed_isolated_per_project_and_size(
    auth_client, species, scientist, ringing_station, organization
):
    from birds.models import Project

    project_a = Project.objects.create(title="A", organization=organization)
    project_b_local = Project.objects.create(title="B", organization=organization)

    _capture(
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        ring_number="0010",
        size=Ring.RingSizes.V,
        project=project_a,
    )
    _capture(
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        ring_number="0020",
        size=Ring.RingSizes.T,
        project=project_a,
    )
    _capture(
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        ring_number="0030",
        size=Ring.RingSizes.V,
        project=project_b_local,
    )

    payload = auth_client.get(BUNDLE_URL).json()
    entries = {
        (row["project_id"], row["size"]): row["number"]
        for row in payload["last_consumed_ring_numbers"]
    }
    assert entries[(str(project_a.id), Ring.RingSizes.V)] == "0010"
    assert entries[(str(project_a.id), Ring.RingSizes.T)] == "0020"
    assert entries[(str(project_b_local.id), Ring.RingSizes.V)] == "0030"


@pytest.mark.django_db
def test_bundle_last_consumed_is_scoped_to_requester_org(
    auth_client,
    species,
    scientist,
    ringing_station,
    project,
    organization,
    scientist_b,
    ringing_station_b,
    project_b,
    organization_b,
):
    _capture(
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        ring_number="0050",
        project=project,
        created=_at(1),
    )
    _capture(
        species=species,
        scientist=scientist_b,
        ringing_station=ringing_station_b,
        ring_number="0099",
        project=project_b,
        created=_at(2),
    )

    payload = auth_client.get(BUNDLE_URL).json()
    entries = payload["last_consumed_ring_numbers"]
    assert len(entries) == 1
    assert entries[0]["project_id"] == str(project.id)
    assert entries[0]["number"] == "0050"
