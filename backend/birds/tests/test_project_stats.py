"""Projekt-Dashboard stats endpoint (PRD #199, issue #201).

A read-only, org-scoped GET aggregating one Projekt's captures over a date
range into ``totals`` + ``last_fangtag`` figures. The counting semantics are
established here and reused by later dashboard slices:

- Fänge = every capture, Erstfang **and** Wiederfang, never deduplicated.
- ``ring_destroyed`` (Ring vernichtet) is excluded from every count.
- ``unknown_species`` (Aves ignota) counts as a Fang, its own labelled bucket,
  and +1 to Artenzahl.
- Artenzahl = distinct species over the range.
- A Fangtag is a Vienna calendar day with ≥1 capture; ``last_fangtag`` is the
  most recent one and ``trend.previous_fangtag`` the immediately-preceding
  *data-bearing* day, computed in Europe/Vienna (timestamps stored UTC).
"""

from datetime import UTC, datetime
from itertools import count

import pytest

from birds.models import DataEntry, Ring

_ring_seq = count(1)


def stats_url(project_id, **params):
    url = f"/api/birds/projects/{project_id}/stats/"
    if params:
        query = "&".join(f"{k}={v}" for k, v in params.items())
        url = f"{url}?{query}"
    return url


def _capture(project, species, ringing_station, scientist, when, *, status="e"):
    """Seed a Ring + DataEntry for ``project`` at instant ``when`` (UTC)."""
    ring = Ring.objects.create(
        number=str(next(_ring_seq)),
        size=Ring.RingSizes.V,
        organization=project.organization,
    )
    return DataEntry.objects.create(
        species=species,
        ring=ring,
        staff=scientist,
        ringing_station=ringing_station,
        project=project,
        bird_status=status,
        date_time=when,
        organization=project.organization,
    )


# --- Access control ----------------------------------------------------------


@pytest.mark.django_db
def test_stats_requires_authentication(api_client, project):
    response = api_client.get(stats_url(project.id))
    assert response.status_code in (401, 403)


@pytest.mark.django_db
def test_foreign_org_project_is_not_found(auth_client, scientist, project_b):
    """Alice (tenant A) asking for a tenant-B Projekt gets a 404 — the row is
    absent from her org-scoped queryset, mirroring ``export-iwm``."""
    response = auth_client.get(stats_url(project_b.id))
    assert response.status_code == 404


# --- Range parsing -----------------------------------------------------------


@pytest.mark.django_db
def test_default_preset_is_week(auth_client, scientist, project):
    response = auth_client.get(stats_url(project.id))
    assert response.status_code == 200
    assert response.data["range"]["preset"] == "week"


@pytest.mark.django_db
def test_explicit_from_to_echoes_range(auth_client, scientist, project):
    response = auth_client.get(stats_url(project.id, **{"from": "2026-06-01", "to": "2026-07-03"}))
    assert response.status_code == 200
    assert response.data["range"]["from"] == "2026-06-01"
    assert response.data["range"]["to"] == "2026-07-03"


# --- Empty range -------------------------------------------------------------


@pytest.mark.django_db
def test_empty_range_returns_zeroed_payload(auth_client, scientist, project):
    response = auth_client.get(stats_url(project.id, **{"from": "2026-06-01", "to": "2026-07-03"}))
    assert response.status_code == 200
    assert response.data["totals"] == {"faenge": 0, "artenzahl": 0}
    assert response.data["last_fangtag"] is None


# --- Counting semantics + last_fangtag ---------------------------------------


@pytest.mark.django_db
def test_counting_semantics_and_last_fangtag(
    auth_client,
    scientist,
    project,
    ringing_station,
    species,
    species_other,
    aves_ignota_species,
    sentinel_species,
):
    """A rich two-Fangtag scenario across a multi-day gap.

    July 2 (CEST = UTC+2) is the last Fangtag; June 28 the previous one; the
    calendar days between them are empty and must be skipped. Ring vernichtet is
    excluded everywhere; Aves ignota counts as a Fang, its own bucket, and bumps
    Artenzahl.
    """
    # --- last Fangtag: 2026-07-02 (Vienna) ---
    # 3× Alpha at 06:00 Vienna (04:00 UTC), incl. one Wiederfang (still counted).
    _capture(project, species, ringing_station, scientist, datetime(2026, 7, 2, 4, 0, tzinfo=UTC))
    _capture(project, species, ringing_station, scientist, datetime(2026, 7, 2, 4, 10, tzinfo=UTC))
    _capture(
        project,
        species,
        ringing_station,
        scientist,
        datetime(2026, 7, 2, 4, 20, tzinfo=UTC),
        status="w",
    )
    # 1× Beta at 07:00 Vienna.
    _capture(
        project, species_other, ringing_station, scientist, datetime(2026, 7, 2, 5, 0, tzinfo=UTC)
    )
    # 1× Aves ignota — a Fang, own bucket, +1 Artenzahl.
    _capture(
        project,
        aves_ignota_species,
        ringing_station,
        scientist,
        datetime(2026, 7, 2, 5, 30, tzinfo=UTC),
    )
    # 1× Ring vernichtet — excluded from every count.
    _capture(
        project,
        sentinel_species,
        ringing_station,
        scientist,
        datetime(2026, 7, 2, 6, 0, tzinfo=UTC),
    )

    # --- previous Fangtag: 2026-06-28 (Vienna), with empty days in between ---
    _capture(project, species, ringing_station, scientist, datetime(2026, 6, 28, 8, 0, tzinfo=UTC))
    _capture(project, species, ringing_station, scientist, datetime(2026, 6, 28, 9, 0, tzinfo=UTC))

    response = auth_client.get(stats_url(project.id, **{"from": "2026-06-01", "to": "2026-07-03"}))
    assert response.status_code == 200
    data = response.data

    # totals over the whole range: 5 (July 2, ring_destroyed excluded) + 2 (June 28) = 7.
    assert data["totals"]["faenge"] == 7
    # distinct species over range: Alpha, Beta, Aves ignota = 3 (ring_destroyed excluded).
    assert data["totals"]["artenzahl"] == 3

    last = data["last_fangtag"]
    assert last["date"] == "2026-07-02"
    assert last["faenge"] == 5  # 3 Alpha + 1 Beta + 1 Aves ignota (ring_destroyed excluded)

    # Trend is against the immediately-preceding *data-bearing* day, not the
    # empty calendar day before July 2.
    assert last["trend"]["previous_fangtag"] == "2026-06-28"
    assert last["trend"]["previous_faenge"] == 2
    assert last["trend"]["delta"] == 3

    # Häufigste Art of the last Fangtag: Alpha with 3.
    assert last["haeufigste_art"]["species_id"] == str(species.id)
    assert last["haeufigste_art"]["name"] == species.common_name_de
    assert last["haeufigste_art"]["count"] == 3

    # Strongest hour: 06:00 Vienna carried 3 Alpha captures.
    assert last["strongest_hour"]["hour"] == 6
    assert last["strongest_hour"]["count"] == 3


@pytest.mark.django_db
def test_aves_ignota_labelled_as_haeufigste_art(
    auth_client, scientist, project, ringing_station, aves_ignota_species, species
):
    """When Aves ignota dominates a day it is the häufigste Art, labelled by its
    own ``common_name_de``."""
    _capture(
        project,
        aves_ignota_species,
        ringing_station,
        scientist,
        datetime(2026, 7, 2, 4, 0, tzinfo=UTC),
    )
    _capture(
        project,
        aves_ignota_species,
        ringing_station,
        scientist,
        datetime(2026, 7, 2, 4, 5, tzinfo=UTC),
    )
    _capture(project, species, ringing_station, scientist, datetime(2026, 7, 2, 4, 10, tzinfo=UTC))

    response = auth_client.get(stats_url(project.id, **{"from": "2026-07-01", "to": "2026-07-03"}))
    last = response.data["last_fangtag"]
    assert last["haeufigste_art"]["species_id"] == str(aves_ignota_species.id)
    assert last["haeufigste_art"]["name"] == aves_ignota_species.common_name_de
    assert last["haeufigste_art"]["count"] == 2


@pytest.mark.django_db
def test_strongest_hour_buckets_across_vienna_day_boundary(
    auth_client, scientist, project, ringing_station, species
):
    """A capture stored at 2026-07-01T23:30Z is 2026-07-02T01:30 in Vienna
    (CEST) — it belongs to the July 2 Fangtag, hour 1, not July 1 hour 23."""
    # Two captures that land in Vienna hour 1 of July 2.
    _capture(project, species, ringing_station, scientist, datetime(2026, 7, 1, 23, 30, tzinfo=UTC))
    _capture(project, species, ringing_station, scientist, datetime(2026, 7, 1, 23, 45, tzinfo=UTC))
    # One capture later the same Vienna day at hour 8.
    _capture(project, species, ringing_station, scientist, datetime(2026, 7, 2, 6, 0, tzinfo=UTC))

    response = auth_client.get(stats_url(project.id, **{"from": "2026-07-01", "to": "2026-07-03"}))
    last = response.data["last_fangtag"]
    assert last["date"] == "2026-07-02"
    assert last["faenge"] == 3
    assert last["strongest_hour"]["hour"] == 1
    assert last["strongest_hour"]["count"] == 2


@pytest.mark.django_db
def test_single_fangtag_has_null_previous(
    auth_client, scientist, project, ringing_station, species
):
    """One Fangtag in range: last_fangtag is present, but there is no previous
    data-bearing day, so the trend has null previous fields and a delta equal to
    the day's own Fänge."""
    _capture(project, species, ringing_station, scientist, datetime(2026, 7, 2, 4, 0, tzinfo=UTC))

    response = auth_client.get(stats_url(project.id, **{"from": "2026-07-01", "to": "2026-07-03"}))
    last = response.data["last_fangtag"]
    assert last["date"] == "2026-07-02"
    assert last["faenge"] == 1
    assert last["trend"]["previous_fangtag"] is None
    assert last["trend"]["previous_faenge"] is None
    assert last["trend"]["delta"] == 1
