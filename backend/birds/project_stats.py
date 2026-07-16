"""Projekt-Dashboard aggregation (PRD #199, issue #201).

The single home of the dashboard's counting semantics, so the "Letzter Tag"
card and every later slice share one definition of a Fang, a Fangtag and an
Artenzahl. Aggregation is SQL-side and timezone-correct (day/hour boundaries in
Europe/Vienna; timestamps stored UTC, ``USE_TZ=True`` — ADR 0017).

Counting rules (apply to every count):

- Fänge = captures, Erstfang **and** Wiederfang, never deduplicated across days.
- ``ring_destroyed`` (Ring vernichtet) is excluded from every count.
- ``unknown_species`` (Aves ignota) counts as a Fang, its own labelled bucket,
  and +1 to Artenzahl (it is one Species row, so a distinct-species count buckets
  every Aves ignota together automatically).
- Artenzahl = distinct species over the range.
- A Fangtag is a Vienna calendar day with ≥1 capture.
"""

import calendar
import datetime
from zoneinfo import ZoneInfo

from django.db.models import Count, Min
from django.db.models.functions import ExtractHour, TruncDate

from .models import DataEntry, Species

VIENNA = ZoneInfo("Europe/Vienna")

# The named range presets. ``today`` and ``season`` are additive (ADR 0029):
# ``today`` is a one-day range; ``season`` resolves the Projekt's own recurring
# month window. The other four keep their prior lower-bound-to-today semantics.
PRESETS = ("week", "month", "year", "all", "today", "season")
DEFAULT_PRESET = "week"


def _preset_from(today, preset):
    """The inclusive lower bound (a Vienna date) for a preset, or ``None`` for
    ``all`` (no lower bound). ``to`` is always ``today``."""
    if preset == "week":
        return today - datetime.timedelta(days=7)
    if preset == "month":
        month = today.month - 1 or 12
        year = today.year - (1 if today.month == 1 else 0)
        day = min(today.day, calendar.monthrange(year, month)[1])
        return datetime.date(year, month, day)
    if preset == "year":
        try:
            return today.replace(year=today.year - 1)
        except ValueError:  # 29 Feb → 28 Feb in a non-leap year
            return today.replace(year=today.year - 1, day=28)
    return None  # "all"


def _season_range(today, start_month, end_month):
    """Resolve the „Diese Saison" bounds against Vienna ``today`` for an
    inclusive, wrap-around-allowed month window ``[start_month, end_month]``
    (1–12; ADR 0029).

    In-season (``today`` inside the current occurrence) ⇒ ``(occurrence start,
    today)`` — capped at today, never a future date. Off-season ⇒ the
    most-recently-ended occurrence ``[start, end]``, so the dashboard shows the
    last season's result. Always a populated, meaningful range."""
    month = today.month
    wrap = start_month > end_month
    in_season = (
        (month >= start_month or month <= end_month)
        if wrap
        else (start_month <= month <= end_month)
    )
    if in_season:
        # The current occurrence's start is this year's start month — except in
        # the spring tail of a wrap-around window (month <= end_month), where the
        # occurrence began last November.
        start_year = today.year - 1 if wrap and month <= end_month else today.year
        return datetime.date(start_year, start_month, 1), today
    # Off-season: the most-recently-ended occurrence.
    if wrap:
        # end_month < month < start_month: the occurrence that started last year
        # ended this year at end_month.
        occ_start = datetime.date(today.year - 1, start_month, 1)
        occ_end_year = today.year
    elif month > end_month:
        # This year's occurrence already ran and ended.
        occ_start = datetime.date(today.year, start_month, 1)
        occ_end_year = today.year
    else:
        # month < start_month: this year's occurrence has not started; last
        # year's is the most-recently-ended one.
        occ_start = datetime.date(today.year - 1, start_month, 1)
        occ_end_year = today.year - 1
    last_day = calendar.monthrange(occ_end_year, end_month)[1]
    return occ_start, datetime.date(occ_end_year, end_month, last_day)


def resolve_range(
    *,
    today,
    preset=None,
    date_from=None,
    date_to=None,
    saison_start_month=None,
    saison_end_month=None,
):
    """Resolve the request's range into ``(preset, date_from, date_to)``.

    Explicit ``from``/``to`` win over a preset and clear it (``preset=None``);
    otherwise the named preset (default ``week``) computes the bounds against
    ``today`` (a Vienna date). ``today`` is a one-day range; ``season`` resolves
    the Projekt's recurring month window (``saison_start_month``/
    ``saison_end_month``) — falling back to the default preset when no window is
    configured (either month ``None``). ``date_from`` may be ``None`` for an open
    lower bound (``all``)."""
    if date_from is not None or date_to is not None:
        return None, date_from, date_to or today
    has_season = saison_start_month is not None and saison_end_month is not None
    if preset == "season" and not has_season:
        preset = DEFAULT_PRESET
    if preset not in PRESETS:
        preset = DEFAULT_PRESET
    if preset == "today":
        return preset, today, today
    if preset == "season":
        date_from, date_to = _season_range(today, saison_start_month, saison_end_month)
        return preset, date_from, date_to
    return preset, _preset_from(today, preset), today


def _range_bounds(date_from, date_to):
    """Half-open UTC-comparable instants for the inclusive Vienna date range."""
    start = (
        datetime.datetime.combine(date_from, datetime.time.min, tzinfo=VIENNA)
        if date_from is not None
        else None
    )
    end = (
        datetime.datetime.combine(
            date_to + datetime.timedelta(days=1), datetime.time.min, tzinfo=VIENNA
        )
        if date_to is not None
        else None
    )
    return start, end


def compute_project_stats(project, *, preset=None, date_from=None, date_to=None, today=None):
    """Aggregate one Projekt's captures over a date range into the dashboard
    payload: ``range`` + ``totals`` + ``last_fangtag`` (``None`` when empty)."""
    if today is None:
        from django.utils import timezone

        today = timezone.localdate()

    preset, date_from, date_to = resolve_range(
        today=today,
        preset=preset,
        date_from=date_from,
        date_to=date_to,
        saison_start_month=project.saison_start_month,
        saison_end_month=project.saison_end_month,
    )
    start, end = _range_bounds(date_from, date_to)

    # The single root every figure below reads. Deleted (``is_cancelled``)
    # captures are excluded here once, not per helper (ADR 0030): the rule is
    # „unsichtbar für jede Abfrage", and filtering at the root is what stops the
    # next figure added to this module from quietly forgetting it.
    captures = DataEntry.objects.filter(project=project, is_cancelled=False).exclude(
        species__special_kind=Species.SpecialKind.RING_DESTROYED
    )
    if start is not None:
        captures = captures.filter(date_time__gte=start)
    if end is not None:
        captures = captures.filter(date_time__lt=end)

    payload = {
        "range": {
            "from": date_from.isoformat() if date_from is not None else None,
            "to": date_to.isoformat() if date_to is not None else None,
            "preset": preset,
        },
        "totals": _totals(captures),
        "top_species": _top_species(captures),
        "erstnachweise": _erstnachweise(captures),
        "series": _series(captures),
        "hour_histogram": _hour_histogram(captures),
        "last_fangtag": _last_fangtag(captures),
    }
    return payload


def _totals(captures):
    """The KPI-row totals over the range (issue #293), all under the module's
    shared counting rules — ``captures`` already excludes Ring vernichtet and
    still includes Aves ignota.

    ``faenge = erstfaenge + wiederfaenge`` (every capture carries a
    ``bird_status`` of exactly one). ``fangtage`` counts distinct Europe/Vienna
    capture days in range (a Ring-vernichtet-only day is not a Fangtag, since
    those records never reach ``captures``). Wiederfang-Anteil and Ø/Fangtag are
    derived client-side from these served counts, never here."""
    return {
        "faenge": captures.count(),
        "artenzahl": captures.values("species_id").distinct().count(),
        "fangtage": (
            captures.annotate(day=TruncDate("date_time", tzinfo=VIENNA))
            .values("day")
            .distinct()
            .count()
        ),
        "erstfaenge": captures.filter(bird_status=DataEntry.BirdStatus.FIRST_CATCH).count(),
        "wiederfaenge": captures.filter(bird_status=DataEntry.BirdStatus.RE_CATCH).count(),
    }


TOP_SPECIES_LIMIT = 10


def _top_species(captures):
    """The häufigsten Arten over the whole range (issue #202), each
    ``{species_id, name, count}`` ordered by total Fänge (desc, name as
    tie-break). Same counting as the card: Ring vernichtet is already excluded
    from ``captures``; Aves ignota is one Species row, so it buckets as its own
    labelled entry (its ``common_name_de``). Capped to the top N for the bar
    chart."""
    rows = (
        captures.values("species_id", "species__common_name_de")
        .annotate(c=Count("id"))
        .order_by("-c", "species__common_name_de")[:TOP_SPECIES_LIMIT]
    )
    return [
        {
            "species_id": str(row["species_id"]),
            "name": row["species__common_name_de"],
            "count": row["c"],
        }
        for row in rows
    ]


ERSTNACHWEIS_LIMIT = 5


def _erstnachweise(captures):
    """The season's arrival feed (issue #297): the per-Art **Erstnachweis** —
    each Art's *first record within the range* — newest-first, capped at five.

    An „Erstnachweis" is the first *record* of a species in the range,
    deliberately not an „Erstfang" (the first capture of an individual bird — a
    new ring). A **Sonderart is not an Art record**: Aves ignota is excluded
    here (and Ring vernichtet is already excluded from ``captures``), so only
    real, identified Arten form arrivals. Each entry carries the Art (id, German
    name and wissenschaftlicher Name), the Europe/Vienna date of its first
    in-range record, and that first record's Beringer.
    """
    art_captures = captures.filter(species__special_kind=Species.SpecialKind.NORMAL)
    # Per-Art first-record instant, newest-first, capped — ordered in SQL so no
    # per-row datetime handling is needed for the ranking itself.
    ranked = (
        art_captures.values("species_id", "species__common_name_de", "species__scientific_name")
        .annotate(first=Min("date_time"))
        .order_by("-first")[:ERSTNACHWEIS_LIMIT]
    )
    result = []
    for row in ranked:
        earliest = (
            art_captures.filter(species_id=row["species_id"])
            .select_related("staff")
            .order_by("date_time", "id")
            .first()
        )
        beringer = earliest.staff.full_name or earliest.staff.handle
        result.append(
            {
                "species_id": str(row["species_id"]),
                "name": row["species__common_name_de"],
                "scientific_name": row["species__scientific_name"],
                "date": earliest.date_time.astimezone(VIENNA).date().isoformat(),
                "beringer": beringer,
            }
        )
    return result


SERIES_TOP_N = 8
UEBRIGE_LABEL = "Übrige"


def _series(captures):
    """The per-Fangtag line series for the Top-N-Liniendiagramm (issue #203).

    A **sparse** day axis — only the Vienna Fangtage that actually happened in
    range, ascending, never a padded continuous calendar — plus one counts-line
    per Art. The **top-N** Arten by total Fänge in range (``SERIES_TOP_N``, the
    same ``-count, name`` ordering as ``top_species``) each get their own line;
    every remaining Art is summed into a single ``Übrige`` line
    (``species_id: None``). Each line's ``counts`` align position-for-position to
    ``days``. Ring vernichtet is already excluded from ``captures``, so it never
    forms a Fangtag or a line; Aves ignota is one Species row and buckets as its
    own labelled line.
    """
    days = list(
        captures.annotate(day=TruncDate("date_time", tzinfo=VIENNA))
        .values_list("day", flat=True)
        .distinct()
        .order_by("day")
    )
    if not days:
        return {"days": [], "lines": []}

    day_index = {day: i for i, day in enumerate(days)}

    ranked = list(
        captures.values("species_id", "species__common_name_de")
        .annotate(c=Count("id"))
        .order_by("-c", "species__common_name_de")
    )
    top = ranked[:SERIES_TOP_N]
    top_ids = {row["species_id"] for row in top}
    has_uebrige = len(ranked) > len(top)

    per_species_day = (
        captures.annotate(day=TruncDate("date_time", tzinfo=VIENNA))
        .values("species_id", "day")
        .annotate(c=Count("id"))
    )
    top_counts = {row["species_id"]: [0] * len(days) for row in top}
    uebrige_counts = [0] * len(days)
    for row in per_species_day:
        idx = day_index[row["day"]]
        if row["species_id"] in top_ids:
            top_counts[row["species_id"]][idx] = row["c"]
        else:
            uebrige_counts[idx] += row["c"]

    lines = [
        {
            "species_id": str(row["species_id"]),
            "name": row["species__common_name_de"],
            "counts": top_counts[row["species_id"]],
        }
        for row in top
    ]
    if has_uebrige:
        lines.append({"species_id": None, "name": UEBRIGE_LABEL, "counts": uebrige_counts})

    return {"days": [day.isoformat() for day in days], "lines": lines}


HOURS_PER_DAY = 24


def _hour_histogram(captures):
    """Fänge per Europe/Vienna clock hour (0–23) over the whole range for the
    Fangaktivität-nach-Tagesstunde histogram (issue #296).

    A fixed 24-slot list indexed by hour, so an empty range yields a zeroed
    histogram (``[0] * 24``) rather than a missing or short array — the chart
    always has 24 buckets, never an error state. Hours are bucketed on the Vienna
    clock (timestamps stored UTC, ``USE_TZ=True`` — ADR 0017): a capture at
    2026-07-01T23:30Z lands in Vienna hour 1, not 23. Same counting as the rest
    of the module — ``captures`` already excludes Ring vernichtet and still
    includes Aves ignota.
    """
    counts = [0] * HOURS_PER_DAY
    rows = (
        captures.annotate(hour=ExtractHour("date_time", tzinfo=VIENNA))
        .values("hour")
        .annotate(c=Count("id"))
    )
    for row in rows:
        counts[row["hour"]] = row["c"]
    return counts


def _last_fangtag(captures):
    """The most-recent Fangtag block, or ``None`` when the range is empty."""
    day_counts = list(
        captures.annotate(day=TruncDate("date_time", tzinfo=VIENNA))
        .values("day")
        .annotate(c=Count("id"))
        .order_by("-day")
    )
    if not day_counts:
        return None

    last_day = day_counts[0]["day"]
    last_faenge = day_counts[0]["c"]
    previous = day_counts[1] if len(day_counts) > 1 else None
    previous_faenge = previous["c"] if previous else None

    day_captures = captures.annotate(day=TruncDate("date_time", tzinfo=VIENNA)).filter(day=last_day)

    top = (
        day_captures.values("species_id", "species__common_name_de")
        .annotate(c=Count("id"))
        .order_by("-c", "species__common_name_de")
        .first()
    )
    hour = (
        day_captures.annotate(h=ExtractHour("date_time", tzinfo=VIENNA))
        .values("h")
        .annotate(c=Count("id"))
        .order_by("-c", "h")
        .first()
    )

    return {
        "date": last_day.isoformat(),
        "faenge": last_faenge,
        "trend": {
            "previous_fangtag": previous["day"].isoformat() if previous else None,
            "previous_faenge": previous_faenge,
            "delta": last_faenge - (previous_faenge or 0),
        },
        "haeufigste_art": {
            "species_id": str(top["species_id"]),
            "name": top["species__common_name_de"],
            "count": top["c"],
        }
        if top
        else None,
        "strongest_hour": {"hour": hour["h"], "count": hour["c"]} if hour else None,
    }
