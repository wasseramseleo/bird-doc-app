"""Deterministic IWM anonymiser (issue #177, ADR 0012).

There is a real IWM ``Datenmeldung`` export sitting outside the repo and a safe,
committed ``demo_iwm.xlsx`` the Referenzprojekt is seeded from (ADR 0012). This
module is the bridge: a pure, testable transform that reads *any* IWM
``Fangdaten`` sheet and rewrites it into a de-identified sheet **in the same
format**, so it runs identically on the synthetic ``sample_iwm_illmitz.xlsx`` now
and the real export later — no code change. The thin ``anonymize_iwm`` management
command only wraps ``load_workbook → anonymize_workbook → save``.

The transform preserves the sheet's layout and every column it does not touch;
only reality-linking fields are rewritten:

* **Deterministic.** A fixed RNG seed (``DEMO_SEED``) and stable hashing — never
  wall-clock time — so a given input always yields byte-identical output.
* **Cast collapse.** Every distinct real Beringer Kürzel maps by a stable hash
  onto one of two curated Kürzel (the demo Admin ``ABE`` and the no-account helper
  ``MHU``); the same real Kürzel always lands on the same curated one. Every
  Station collapses onto the one curated Station (``CURATED_STATION``).
* **Ring renumbering.** Ring *size* is kept; the number is remapped through one
  shared ``(size, real number) → demo number`` table, so an Erstfang, its
  Wiederfänge and a *Ring vernichtet* row sharing a ring all get the same demo
  ring. Per size, distinct real numbers map in ascending order to a sequential,
  zero-padded demo range from a fixed base — order-preserving and injective.
* **Date shift.** A single global whole-year offset
  (``TARGET_END_YEAR − max real capture year``) is applied to every date, so
  month/day, seasonality and Erstfang→Wiederfang ordering survive; a 29 Feb
  landing in a non-leap target year clamps to 28 Feb. ``Uhrzeit`` is untouched.
* **Biometric jitter.** Each *present* biometric is perturbed by ±5 % and rounded
  to two places; a blank biometric stays blank (so *Ring vernichtet* rows keep no
  bird data).
* **Free text.** ``Bemerkungen`` are emptied, except *Aves ignota* rows (whose
  Bemerkung is mandatory) which get a fixed generic placeholder.

Everything else is kept as-is for realism (``Art``, ``Geschlecht``, ``Alter``,
``Ringstatus``, the Fett/Muskel/Intensität/Fortschritt/Handschwingen codes,
``Netz``, and the Projekt-context codes Umstand/Fangmethode/Lockmittel).

The constants below are meant to be tuned/bumped, not treated as a fixed
contract: the target year, the ring base/width, the jitter magnitude and the
placeholder identities.
"""

import calendar
import hashlib
import random
import re
from collections import defaultdict
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

SHEET_NAME = "Fangdaten"

# --- tunable constants (ADR 0012: bump, don't treat as contract) -----------
DEMO_SEED = 20250101  # fixed RNG seed → reproducible, wall-clock-independent
TARGET_END_YEAR = 2025  # every date shifts so the latest capture year lands here
DEMO_RING_BASE = 1  # first demo number per ring size
DEMO_RING_WIDTH = 5  # zero-pad width of a demo ring number
JITTER_FRACTION = Decimal("0.05")  # ±5 % biometric perturbation

# The curated cast: the demo Admin (with account) and the no-account helper.
CURATED_KUERZEL = ("ABE", "MHU")
# The single curated Station — deliberately coarse coordinates.
CURATED_STATION = {
    "name": "Neusiedlersee – Illmitz",
    "place_code": "AT21",
    "region": "Burgenland",
    "country": "AT",
    "coordinates": "47.80, 16.75",
}
AVES_IGNOTA_ART = "Art nicht in der Liste (Aves ignota)"
AVES_IGNOTA_PLACEHOLDER = "Unbestimmte Art; Nachweis dokumentiert und geprüft."

# Continuous biometrics jittered where present (the DecimalField measurements).
BIOMETRIC_COLUMNS = ("Flügellänge", "Teilfederlänge", "Gewicht", "Tarsus")
# Fangdaten column → curated-Station field written onto every data row.
STATION_COLUMNS = {
    "Ort": "name",
    "Ortskodierung": "place_code",
    "Region": "region",
    "Land": "country",
    "Geo-Koordinaten": "coordinates",
}

_TWO_PLACES = Decimal("0.01")
_RINGNUMMER_RE = re.compile(r"^([A-Za-z]+)(\d+)$")


class AnonymizeStructureError(Exception):
    """The workbook has no ``Fangdaten`` sheet, so there is nothing to anonymise.
    Raised before any cell is touched so the CLI wrapper can fast-fail cleanly."""


def anonymize_workbook(workbook):
    """De-identify the ``Fangdaten`` sheet of ``workbook`` in place and return it.

    Two passes over the data rows: the first collects the real ring identities and
    capture years to build the ring-renumber table and the whole-year date offset;
    the second rewrites the reality-linking cells. Row order and every untouched
    column are preserved, so the result is a valid ``Datenmeldung`` in the same
    format the importer reads."""
    if SHEET_NAME not in workbook.sheetnames:
        raise AnonymizeStructureError(f"Das Blatt „{SHEET_NAME}“ fehlt in der Datei.")
    worksheet = workbook[SHEET_NAME]
    header_index = _header_index(worksheet)
    data_rows = [row for row in worksheet.iter_rows(min_row=2) if not _is_empty(row)]

    ring_map = _build_ring_map(_collect_real_rings(data_rows, header_index))
    offset = _date_offset(_collect_years(data_rows, header_index))
    rng = random.Random(DEMO_SEED)

    for cells in data_rows:
        _collapse_beringer(cells, header_index)
        _renumber_ring(cells, header_index, ring_map)
        _shift_datum(cells, header_index, offset)
        _collapse_station(cells, header_index)
        _scrub_bemerkung(cells, header_index)
        _jitter_biometrics(cells, header_index, rng)
    return workbook


# --- workbook helpers ------------------------------------------------------


def _header_index(worksheet):
    header = next(worksheet.iter_rows(min_row=1, max_row=1))
    return {cell.value: cell.column for cell in header if cell.value}


def _cell(cells, header_index, header):
    column = header_index.get(header)
    if column is None or column > len(cells):
        return None
    return cells[column - 1]


def _is_empty(cells):
    return all(cell.value is None for cell in cells)


def _text(cell):
    if cell is None or cell.value is None:
        return ""
    return str(cell.value).strip()


# --- cast collapse ---------------------------------------------------------


def _collapse_beringer(cells, header_index):
    cell = _cell(cells, header_index, "BeringerIn")
    kuerzel = _text(cell)
    if kuerzel:
        cell.value = _curated_kuerzel(kuerzel)


def _curated_kuerzel(real_kuerzel):
    """Map a real Kürzel onto a curated one by a stable (non-salted) hash, so the
    same real Kürzel always lands on the same curated one across runs."""
    digest = hashlib.md5(real_kuerzel.encode("utf-8")).hexdigest()
    return CURATED_KUERZEL[int(digest, 16) % len(CURATED_KUERZEL)]


def _collapse_station(cells, header_index):
    for header, field in STATION_COLUMNS.items():
        cell = _cell(cells, header_index, header)
        if cell is not None:
            cell.value = CURATED_STATION[field]


# --- ring renumbering ------------------------------------------------------


def _collect_real_rings(data_rows, header_index):
    for cells in data_rows:
        parsed = _parse_ring(_text(_cell(cells, header_index, "Ringnummer")))
        if parsed is not None:
            yield parsed


def _parse_ring(ringnummer):
    match = _RINGNUMMER_RE.match(ringnummer)
    if not match:
        return None
    return match.group(1).upper(), match.group(2)


def _build_ring_map(real_rings):
    """Build the shared ``(size, real number) → demo number`` table. Per size, the
    distinct real numbers are sorted ascending and assigned a sequential,
    zero-padded demo range from ``DEMO_RING_BASE`` — order-preserving and injective
    within the size, and size is never changed."""
    by_size = defaultdict(set)
    for size, number in real_rings:
        by_size[size].add(number)
    ring_map = {}
    for size, numbers in by_size.items():
        for offset, number in enumerate(sorted(numbers, key=int)):
            demo = str(DEMO_RING_BASE + offset).zfill(DEMO_RING_WIDTH)
            ring_map[(size, number)] = demo
    return ring_map


def _renumber_ring(cells, header_index, ring_map):
    cell = _cell(cells, header_index, "Ringnummer")
    parsed = _parse_ring(_text(cell))
    if parsed is None:
        return
    size, number = parsed
    cell.value = f"{size}{ring_map[(size, number)]}"


# --- date shift ------------------------------------------------------------


def _collect_years(data_rows, header_index):
    for cells in data_rows:
        value = _cell(cells, header_index, "Datum")
        year = _year_of(value.value if value is not None else None)
        if year is not None:
            yield year


def _year_of(value):
    if isinstance(value, (datetime, date)):
        return value.year
    return None


def _date_offset(years):
    years = list(years)
    if not years:
        return 0
    return TARGET_END_YEAR - max(years)


def _shift_datum(cells, header_index, offset):
    cell = _cell(cells, header_index, "Datum")
    if cell is None or not isinstance(cell.value, (datetime, date)):
        return
    cell.value = _shift_date(cell.value, offset)


def _shift_date(value, offset):
    """Shift ``value`` by ``offset`` whole years, keeping month/day (a 29 Feb into a
    non-leap year clamps to 28 Feb) and any time component. Always returns a
    ``datetime`` so the cell keeps its date number format."""
    if isinstance(value, datetime):
        day_value, time_value = value.date(), value.time()
    else:
        day_value, time_value = value, None
    year = day_value.year + offset
    month, day = day_value.month, day_value.day
    if month == 2 and day == 29 and not calendar.isleap(year):
        day = 28
    if time_value is None:
        return datetime(year, month, day)
    return datetime(year, month, day, time_value.hour, time_value.minute, time_value.second)


# --- free text -------------------------------------------------------------


def _scrub_bemerkung(cells, header_index):
    cell = _cell(cells, header_index, "Bemerkungen")
    if cell is None:
        return
    art = _text(_cell(cells, header_index, "Art"))
    cell.value = AVES_IGNOTA_PLACEHOLDER if art == AVES_IGNOTA_ART else None


# --- biometric jitter ------------------------------------------------------


def _jitter_biometrics(cells, header_index, rng):
    for header in BIOMETRIC_COLUMNS:
        cell = _cell(cells, header_index, header)
        if cell is None or cell.value in (None, ""):
            continue
        jittered = _jitter(cell.value, rng)
        if jittered is not None:
            cell.value = jittered


def _jitter(value, rng):
    original = _to_decimal(value)
    if original is None:
        return None
    factor = Decimal(str(rng.uniform(-float(JITTER_FRACTION), float(JITTER_FRACTION))))
    return (original * (Decimal(1) + factor)).quantize(_TWO_PLACES, rounding=ROUND_HALF_UP)


def _to_decimal(value):
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
