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

from django.db.models import Count
from django.db.models.functions import ExtractHour, TruncDate

from .models import DataEntry, Species

VIENNA = ZoneInfo("Europe/Vienna")

PRESETS = ("week", "month", "year", "all")
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


def resolve_range(*, today, preset=None, date_from=None, date_to=None):
    """Resolve the request's range into ``(preset, date_from, date_to)``.

    Explicit ``from``/``to`` win over a preset and clear it (``preset=None``);
    otherwise the named preset (default ``week``) computes the bounds against
    ``today`` (a Vienna date). ``date_from`` may be ``None`` for an open lower
    bound (``all``)."""
    if date_from is not None or date_to is not None:
        return None, date_from, date_to or today
    if preset not in PRESETS:
        preset = DEFAULT_PRESET
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
        today=today, preset=preset, date_from=date_from, date_to=date_to
    )
    start, end = _range_bounds(date_from, date_to)

    captures = DataEntry.objects.filter(project=project).exclude(
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
        "totals": {
            "faenge": captures.count(),
            "artenzahl": captures.values("species_id").distinct().count(),
        },
        "top_species": _top_species(captures),
        "last_fangtag": _last_fangtag(captures),
    }
    return payload


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
