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

from birds.models import DataEntry, Ring, Species

_ring_seq = count(1)


def _make_species(name):
    """A plain (non-Sonderart) Species row for series/top-N tests."""
    return Species.objects.create(
        common_name_de=name,
        common_name_en=name,
        scientific_name=name,
        family_name="Testidae",
        order_name="Testiformes",
        ring_size=Ring.RingSizes.V,
    )


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
    # Every totals figure — the original two plus the additively-added
    # fangtage/erstfaenge/wiederfaenge (issue #293) — is zeroed for an empty range.
    assert response.data["totals"] == {
        "faenge": 0,
        "artenzahl": 0,
        "fangtage": 0,
        "erstfaenge": 0,
        "wiederfaenge": 0,
    }
    assert response.data["last_fangtag"] is None


# --- totals: fangtage / erstfaenge / wiederfaenge (issue #293) ----------------


@pytest.mark.django_db
def test_totals_split_erstfang_wiederfang_and_count_fangtage(
    auth_client,
    scientist,
    project,
    ringing_station,
    species,
    species_other,
    aves_ignota_species,
    sentinel_species,
):
    """``totals`` additively serves ``fangtage``, ``erstfaenge`` and
    ``wiederfaenge`` under the established counting semantics:

    - ``erstfaenge + wiederfaenge == faenge`` (each capture is one or the other);
    - Ring vernichtet is excluded from every figure and never forms a Fangtag;
    - Aves ignota counts as a Fang and carries its own Erstfang/Wiederfang status;
    - ``fangtage`` counts distinct Europe/Vienna capture days in the range.
    """
    # --- Fangtag A: 2026-07-02 (Vienna) ---
    # 2× Alpha Erstfang, 1× Alpha Wiederfang.
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
    # 1× Aves ignota, recorded as an Erstfang — a Fang, +1 Artenzahl, counts as Erstfang.
    _capture(
        project,
        aves_ignota_species,
        ringing_station,
        scientist,
        datetime(2026, 7, 2, 5, 0, tzinfo=UTC),
    )
    # 1× Ring vernichtet — excluded from every figure.
    _capture(
        project,
        sentinel_species,
        ringing_station,
        scientist,
        datetime(2026, 7, 2, 6, 0, tzinfo=UTC),
    )

    # --- Fangtag B: 2026-06-28 (Vienna) ---
    # 1× Beta Erstfang, 1× Beta Wiederfang.
    _capture(
        project, species_other, ringing_station, scientist, datetime(2026, 6, 28, 8, 0, tzinfo=UTC)
    )
    _capture(
        project,
        species_other,
        ringing_station,
        scientist,
        datetime(2026, 6, 28, 9, 0, tzinfo=UTC),
        status="w",
    )

    # --- A Ring-vernichtet-only Vienna day: must NOT become a Fangtag ---
    _capture(
        project,
        sentinel_species,
        ringing_station,
        scientist,
        datetime(2026, 6, 30, 5, 0, tzinfo=UTC),
    )

    response = auth_client.get(stats_url(project.id, **{"from": "2026-06-01", "to": "2026-07-03"}))
    assert response.status_code == 200
    totals = response.data["totals"]

    # Fänge = 4 (July 2, Ring vernichtet excluded) + 2 (June 28) = 6.
    assert totals["faenge"] == 6
    # Erstfänge: 2 Alpha + 1 Aves ignota + 1 Beta = 4.
    assert totals["erstfaenge"] == 4
    # Wiederfänge: 1 Alpha + 1 Beta = 2.
    assert totals["wiederfaenge"] == 2
    # The split adds up to the Fänge total.
    assert totals["erstfaenge"] + totals["wiederfaenge"] == totals["faenge"]
    # Two distinct Vienna Fangtage; the Ring-vernichtet-only June 30 is not one.
    assert totals["fangtage"] == 2
    # Artenzahl unchanged: Alpha, Beta, Aves ignota = 3.
    assert totals["artenzahl"] == 3


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


# --- hour_histogram (issue #296, Fangaktivität nach Tagesstunde) -------------


@pytest.mark.django_db
def test_hour_histogram_buckets_in_vienna_and_excludes_ring_vernichtet(
    auth_client,
    scientist,
    project,
    ringing_station,
    species,
    aves_ignota_species,
    sentinel_species,
):
    """``hour_histogram`` is Fänge per Europe/Vienna clock hour (0–23) over the
    whole range, a fixed 24-slot list indexed by hour. Hours bucket on the Vienna
    day/hour boundary (timestamps stored UTC): a capture at 2026-07-01T23:30Z is
    01:30 Vienna (CEST) and lands in hour 1, not 23. Same counting as the rest of
    the module — Ring vernichtet excluded, Aves ignota counted as a Fang."""
    # Vienna hour 1 (2026-07-02): two plain captures just before the UTC-day roll.
    _capture(project, species, ringing_station, scientist, datetime(2026, 7, 1, 23, 30, tzinfo=UTC))
    _capture(project, species, ringing_station, scientist, datetime(2026, 7, 1, 23, 45, tzinfo=UTC))
    # Vienna hour 6 (04:00–04:20 UTC): one Aves ignota (counted) + two plain = 3.
    _capture(
        project,
        aves_ignota_species,
        ringing_station,
        scientist,
        datetime(2026, 7, 2, 4, 0, tzinfo=UTC),
    )
    _capture(project, species, ringing_station, scientist, datetime(2026, 7, 2, 4, 10, tzinfo=UTC))
    _capture(project, species, ringing_station, scientist, datetime(2026, 7, 2, 4, 20, tzinfo=UTC))
    # Ring vernichtet, also Vienna hour 6 — excluded from every count.
    _capture(
        project,
        sentinel_species,
        ringing_station,
        scientist,
        datetime(2026, 7, 2, 4, 30, tzinfo=UTC),
    )

    response = auth_client.get(stats_url(project.id, **{"from": "2026-07-01", "to": "2026-07-03"}))
    assert response.status_code == 200
    histogram = response.data["hour_histogram"]

    # A fixed 24-slot list indexed by Vienna clock hour.
    assert len(histogram) == 24
    # Hour 1 carried the two pre-midnight-UTC captures (23:xx Z → 01:xx Vienna).
    assert histogram[1] == 2
    # Hour 6 carried the Aves ignota (counted) + two plain; Ring vernichtet excluded.
    assert histogram[6] == 3
    # Every other hour is zero; the total is the counted Fänge (5, not 6).
    assert sum(histogram) == 5
    assert [hour for hour, count in enumerate(histogram) if count] == [1, 6]


@pytest.mark.django_db
def test_hour_histogram_zeroed_for_empty_range(auth_client, scientist, project):
    """An empty range yields a fully-zeroed 24-slot histogram, never a short or
    missing array — no error state."""
    response = auth_client.get(stats_url(project.id, **{"from": "2026-06-01", "to": "2026-06-30"}))
    assert response.status_code == 200
    assert response.data["hour_histogram"] == [0] * 24


# --- top_species (issue #202, häufigste-Arten bar chart) ---------------------


@pytest.mark.django_db
def test_top_species_ordered_labelled_and_excludes_ring_vernichtet(
    auth_client,
    scientist,
    project,
    ringing_station,
    species,
    species_other,
    aves_ignota_species,
    sentinel_species,
):
    """``top_species`` lists the häufigsten Arten over the whole range ordered by
    total Fänge (desc). Aves ignota is its own labelled entry (its
    ``common_name_de``); Ring vernichtet is excluded entirely — same counting
    semantics as the card."""
    # Alpha: 4 Fänge, spread across two Vienna days (still one species bucket).
    for when in (
        datetime(2026, 7, 1, 5, 0, tzinfo=UTC),
        datetime(2026, 7, 1, 6, 0, tzinfo=UTC),
        datetime(2026, 7, 2, 5, 0, tzinfo=UTC),
        datetime(2026, 7, 2, 6, 0, tzinfo=UTC),
    ):
        _capture(project, species, ringing_station, scientist, when)
    # Aves ignota: 3 Fänge — its own labelled bucket.
    for minute in (0, 10, 20):
        _capture(
            project,
            aves_ignota_species,
            ringing_station,
            scientist,
            datetime(2026, 7, 2, 7, minute, tzinfo=UTC),
        )
    # Beta: 2 Fänge.
    for minute in (0, 10):
        _capture(
            project,
            species_other,
            ringing_station,
            scientist,
            datetime(2026, 7, 2, 8, minute, tzinfo=UTC),
        )
    # Ring vernichtet: 5 records — excluded from top_species entirely.
    for minute in range(5):
        _capture(
            project,
            sentinel_species,
            ringing_station,
            scientist,
            datetime(2026, 7, 2, 9, minute, tzinfo=UTC),
        )

    response = auth_client.get(stats_url(project.id, **{"from": "2026-07-01", "to": "2026-07-03"}))
    assert response.status_code == 200
    top = response.data["top_species"]

    # Ordered by total Fänge desc: Alpha (4), Aves ignota (3), Beta (2).
    assert [row["count"] for row in top] == [4, 3, 2]
    assert [row["name"] for row in top] == [
        species.common_name_de,
        aves_ignota_species.common_name_de,
        species_other.common_name_de,
    ]
    assert top[0]["species_id"] == str(species.id)
    assert top[1]["species_id"] == str(aves_ignota_species.id)

    # Ring vernichtet never appears.
    assert str(sentinel_species.id) not in [row["species_id"] for row in top]
    assert sentinel_species.common_name_de not in [row["name"] for row in top]


@pytest.mark.django_db
def test_top_species_empty_when_range_has_no_captures(auth_client, scientist, project):
    response = auth_client.get(stats_url(project.id, **{"from": "2026-06-01", "to": "2026-06-30"}))
    assert response.status_code == 200
    assert response.data["top_species"] == []


# --- series (issue #203, Top-N-Liniendiagramm Fänge/Fangtag) -----------------


@pytest.mark.django_db
def test_series_is_sparse_top_n_lines_and_folds_rest_into_uebrige(
    auth_client, scientist, project, ringing_station
):
    """The per-Fangtag ``series`` is a sparse day axis (only Fangtage, never a
    padded calendar) and one counts-line per top-N Art, with every remaining Art
    folded into a single ``Übrige`` line (``species_id: null``), aligned to the
    days.

    Ten species across three Fangtage with a multi-day calendar gap between them.
    The top eight (a server constant) by total Fänge in range each get their own
    line; the two smallest fold into Übrige.
    """
    from birds.project_stats import SERIES_TOP_N

    assert SERIES_TOP_N == 8

    # Three Vienna Fangtage; the calendar days between them are empty and must be
    # skipped (never padded into the axis).
    d1 = datetime(2026, 6, 26, 5, 0, tzinfo=UTC)  # → 2026-06-26 Vienna (CEST)
    d2 = datetime(2026, 6, 28, 5, 0, tzinfo=UTC)  # → 2026-06-28 Vienna
    d3 = datetime(2026, 7, 2, 5, 0, tzinfo=UTC)  # → 2026-07-02 Vienna

    species = [_make_species(f"Art {i:02d}") for i in range(10)]

    def seed(sp, when, n):
        for _ in range(n):
            _capture(project, sp, ringing_station, scientist, when)

    # S0: total 10 — spans day 1 and day 3 (counts must align to the axis).
    seed(species[0], d1, 2)
    seed(species[0], d3, 8)
    # S1: total 9 — spans day 2 and day 3.
    seed(species[1], d2, 3)
    seed(species[1], d3, 6)
    # S2..S9 all on day 3, with strictly descending totals so ordering is by
    # count alone: 8, 7, 6, 5, 4, 3, 2, 1.
    for i in range(2, 10):
        seed(species[i], d3, 10 - i)

    response = auth_client.get(stats_url(project.id, **{"from": "2026-06-01", "to": "2026-07-03"}))
    assert response.status_code == 200
    series = response.data["series"]

    # Sparse day axis — exactly the three Fangtage, ascending, no padded gap.
    assert series["days"] == ["2026-06-26", "2026-06-28", "2026-07-02"]

    lines = series["lines"]
    # Eight top-N lines + one Übrige line.
    assert len(lines) == 9

    # Ordered by total Fänge desc; each line's counts align to ``days``.
    assert lines[0]["species_id"] == str(species[0].id)
    assert lines[0]["name"] == species[0].common_name_de
    assert lines[0]["counts"] == [2, 0, 8]

    assert lines[1]["species_id"] == str(species[1].id)
    assert lines[1]["counts"] == [0, 3, 6]

    # The top eight are exactly S0..S7 (each with its own line).
    top_ids = [line["species_id"] for line in lines[:8]]
    assert top_ids == [str(species[i].id) for i in range(8)]

    # The remaining two Arten (S8=2, S9=1) fold into one Übrige line, null id.
    uebrige = lines[-1]
    assert uebrige["species_id"] is None
    assert uebrige["name"] == "Übrige"
    assert uebrige["counts"] == [0, 0, 3]  # both fell on day 3


@pytest.mark.django_db
def test_series_excludes_ring_vernichtet_and_has_no_uebrige_when_within_top_n(
    auth_client, scientist, project, ringing_station, species, species_other, sentinel_species
):
    """With fewer distinct Arten than the top-N cap there is no Übrige line, and
    Ring vernichtet never appears in the series or forms a Fangtag of its own."""
    when = datetime(2026, 7, 2, 5, 0, tzinfo=UTC)
    _capture(project, species, ringing_station, scientist, when)
    _capture(project, species_other, ringing_station, scientist, when)
    # Ring vernichtet on a day with no real capture — must not become a Fangtag.
    _capture(
        project,
        sentinel_species,
        ringing_station,
        scientist,
        datetime(2026, 7, 1, 5, 0, tzinfo=UTC),
    )

    response = auth_client.get(stats_url(project.id, **{"from": "2026-07-01", "to": "2026-07-03"}))
    series = response.data["series"]

    # Only July 2 is a Fangtag — the Ring-vernichtet-only July 1 is excluded.
    assert series["days"] == ["2026-07-02"]
    # Two Arten, both under the top-N cap: two lines, no Übrige. Equal counts
    # (1 each) tie-break by name ascending — Beta ("Yyy…") before Alpha ("Zzz…").
    assert [line["name"] for line in series["lines"]] == [
        species_other.common_name_de,
        species.common_name_de,
    ]
    assert all(line["species_id"] is not None for line in series["lines"])


@pytest.mark.django_db
def test_series_empty_when_range_has_no_captures(auth_client, scientist, project):
    response = auth_client.get(stats_url(project.id, **{"from": "2026-06-01", "to": "2026-06-30"}))
    assert response.status_code == 200
    assert response.data["series"] == {"days": [], "lines": []}


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
