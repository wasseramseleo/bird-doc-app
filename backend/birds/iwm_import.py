"""IWM import service (issue #120, PRD #113).

The other half of the IWM round-trip: where ``iwm_export.py`` turns a Projekt's
captures into an authentic ``Datenmeldung`` ``Fangdaten`` sheet, this turns such
a sheet back into captures in a chosen Projekt. It is the single ingestion code
path — exposed to Org-Admins through the ``import-iwm`` API action and (later)
reused by the demo-seed management command — and it creates captures through the
shared ``capture_service`` so imported rows obey exactly the same invariants as
form-entered ones (ADR 0006 org-scoped rings, ADR 0004 Sonderart rules).

Two phases on one upload (ADR 0013): a **dry-run** parses, validates and returns
an ``ImportPreview`` while writing nothing; a **commit** atomically creates the
importable captures, skips the blocking-error rows, and returns an
``ImportResult``. The report shapes are fixed by the PRD; fields this slice does
not yet populate (``duplicates``, ``warnings``, ``toCreate``, ``cap``) are
present but empty/zero.

Scope of this slice: core columns only (species, ring size+number, Beringer
Kürzel, Station, Datum+Uhrzeit, Ringstatus, Geschlecht, Alter). An unknown
species, a missing required field (no ring number / no date), and — for now — an
unfamiliar Beringer or Station are blocking errors. Duplicate detection, the row
cap, warnings/method precedence, Sonderarten and full biometric fidelity arrive
in later slices.
"""

import re
from datetime import date, datetime, time
from io import BytesIO

import openpyxl
from django.db import transaction
from django.utils.timezone import make_aware

from .capture_service import CaptureValidationError, create_capture
from .models import DataEntry, Ring, RingingStation, Scientist, Species

SHEET_NAME = "Fangdaten"

# The authentic Fangdaten columns the importer needs to build a capture. A file
# missing any of them is structurally wrong and rejected before any row is read.
REQUIRED_HEADERS = frozenset(
    {
        "Ringnummer",
        "Ringstatus",
        "Art",
        "Geschlecht",
        "Alter",
        "Datum",
        "Uhrzeit",
        "Ort",
        "BeringerIn",
    }
)

# A starting row cap (tune by measurement — ADR 0013). The preview reports it;
# enforcement/rejection of over-cap files is a later slice, so the shape is fixed
# without changing behaviour here.
ROW_CAP = 5000

_VALID_RING_SIZES = frozenset(Ring.RingSizes.values)
_RINGNUMMER_RE = re.compile(r"^([A-Za-z]+)(\d+)$")

# Authentic IWM codes → model values (issue #120 AC: Geschlecht U/M/W, Ringstatus
# E/W understood). Alter is already an integer in the sheet.
_GESCHLECHT = {
    "U": DataEntry.Sex.UNKNOWN,
    "M": DataEntry.Sex.MALE,
    "W": DataEntry.Sex.FEMALE,
}
_RINGSTATUS = {
    "E": DataEntry.BirdStatus.FIRST_CATCH,
    "W": DataEntry.BirdStatus.RE_CATCH,
}


class IwmStructureError(Exception):
    """The upload is not a readable ``Datenmeldung`` — wrong file, no ``Fangdaten``
    sheet, or missing required headers. Raised before any row is processed so the
    caller can fast-fail with a clear message (HTTP 400)."""


def build_import_preview(content, project):
    """Dry-run: parse + validate ``content`` against ``project`` and return an
    ``ImportPreview``. Writes nothing."""
    rows = _analyze(content, project)
    seen = _existing_keys(project)
    importable = 0
    duplicates = 0
    errors = []
    for resolved in rows:
        if resolved.error is not None:
            errors.append({"row": resolved.row, "reason": resolved.error})
            continue
        key = _capture_key(resolved.kwargs)
        if key in seen:
            duplicates += 1
        else:
            seen.add(key)
            importable += 1
    return {
        "importable": importable,
        "duplicates": duplicates,
        "errors": errors,
        "warnings": [],
        "toCreate": {"beringer": [], "stationen": []},
        "cap": {"limit": ROW_CAP, "exceeded": len(rows) > ROW_CAP},
    }


@transaction.atomic
def commit_import(content, project):
    """Commit: create every importable capture atomically, skipping blocking-error
    rows and duplicates, and return an ``ImportResult``. All-or-nothing — an
    unexpected failure rolls the whole import back.

    A row whose capture key already exists in the Organisation (or was already
    imported earlier in this same file) is skipped as a duplicate and counted,
    never re-inserted — so re-importing a corrected file cannot double the data
    (issue #122)."""
    rows = _analyze(content, project)
    seen = _existing_keys(project)
    created = 0
    duplicates_skipped = 0
    errors = []
    for resolved in rows:
        if resolved.error is not None:
            errors.append({"row": resolved.row, "reason": resolved.error})
            continue
        key = _capture_key(resolved.kwargs)
        if key in seen:
            duplicates_skipped += 1
            continue
        try:
            create_capture(**resolved.kwargs)
            seen.add(key)
            created += 1
        except CaptureValidationError as exc:
            errors.append({"row": resolved.row, "reason": str(exc.message)})
    return {
        "created": created,
        "duplicatesSkipped": duplicates_skipped,
        "errors": errors,
        "createdBeringer": [],
        "createdStationen": [],
    }


def _capture_key(kwargs):
    """The duplicate-detection key of a resolved row: ring size + number and the
    exact capture datetime (issue #122). An Erstfang and its later Wiederfang
    share the ring but differ by datetime, so their keys differ and both import."""
    return (kwargs["ring_size"], kwargs["ring_number"], kwargs["date_time"])


def _existing_keys(project):
    """The set of capture keys already present in the Projekt's Organisation.

    Built once per import (pre-resolved lookup — ADR 0013) so row classification
    does not re-query. A resolved row whose key is in this set already exists and
    is skipped as a duplicate. Datetimes come back timezone-aware; an aware
    datetime hashes and compares by its UTC instant, so a row whose Datum+Uhrzeit
    the importer localises to the same wall clock matches its stored capture."""
    return {
        (size, number, date_time)
        for size, number, date_time in DataEntry.objects.filter(
            organization=project.organization
        ).values_list("ring__size", "ring__number", "date_time")
    }


class _ResolvedRow:
    """One data row resolved to either capture kwargs (``error is None``) or a
    blocking ``error`` reason, tagged with its 1-based sheet row number."""

    __slots__ = ("row", "kwargs", "error")

    def __init__(self, row, kwargs=None, error=None):
        self.row = row
        self.kwargs = kwargs
        self.error = error


class _Resolver:
    """Org-scoped entity lookups, built once per import so row resolution does not
    re-query. Beringer and Stationen are small (org-scoped); species is looked up
    lazily and cached because the global table is huge."""

    def __init__(self, project):
        self.project = project
        org = project.organization
        self.beringer = {
            s.handle: s for s in Scientist.objects.filter(organization=org) if s.handle
        }
        stations = list(RingingStation.objects.filter(organization=org))
        self.station_by_code = {s.place_code: s for s in stations if s.place_code}
        self.station_by_name = {s.name: s for s in stations if s.name}
        self._species_cache = {}

    def species(self, common_name_de):
        if common_name_de not in self._species_cache:
            self._species_cache[common_name_de] = Species.objects.filter(
                common_name_de=common_name_de
            ).first()
        return self._species_cache[common_name_de]

    def station(self, place_code, name):
        if place_code and place_code in self.station_by_code:
            return self.station_by_code[place_code]
        if name and name in self.station_by_name:
            return self.station_by_name[name]
        return None


def _analyze(content, project):
    """Parse the workbook and resolve every data row. Raises ``IwmStructureError``
    for a structurally-wrong file; otherwise returns a ``_ResolvedRow`` per data
    row (never partial — a bad row becomes an error, not an exception)."""
    header_index, data_rows = _read_fangdaten(content)
    resolver = _Resolver(project)
    return [
        _resolve_row(values, header_index, row_num, project, resolver)
        for row_num, values in data_rows
    ]


def _read_fangdaten(content):
    """Return ``(header_index, data_rows)`` for the ``Fangdaten`` sheet.

    ``header_index`` maps each header to its column offset; ``data_rows`` is a
    list of ``(sheet_row_number, values_tuple)`` for the non-empty data rows."""
    try:
        wb = openpyxl.load_workbook(BytesIO(content), data_only=True, read_only=True)
    except Exception as exc:  # openpyxl raises a grab-bag of errors on junk input
        raise IwmStructureError(
            "Die Datei konnte nicht als Excel-Arbeitsmappe gelesen werden."
        ) from exc

    if SHEET_NAME not in wb.sheetnames:
        wb.close()
        raise IwmStructureError(f"Das Blatt „{SHEET_NAME}“ fehlt in der Datei.")

    ws = wb[SHEET_NAME]
    rows_iter = ws.iter_rows(values_only=True)
    header = next(rows_iter, None)
    if header is None:
        wb.close()
        raise IwmStructureError(f"Das Blatt „{SHEET_NAME}“ ist leer.")

    header_index = {h: i for i, h in enumerate(header) if h}
    missing = REQUIRED_HEADERS - set(header_index)
    if missing:
        wb.close()
        raise IwmStructureError(
            "Der Datei fehlen erforderliche Spalten: " + ", ".join(sorted(missing)) + "."
        )

    data_rows = []
    for row_num, values in enumerate(rows_iter, start=2):
        if all(v is None for v in values):
            continue
        data_rows.append((row_num, values))
    wb.close()
    return header_index, data_rows


def _resolve_row(values, header_index, row_num, project, resolver):
    """Resolve one data row into capture kwargs or the first blocking error."""

    def text(header):
        return _clean(_cell(values, header_index, header))

    ringnummer = text("Ringnummer")
    if not ringnummer:
        return _ResolvedRow(row_num, error="Ringnummer fehlt.")
    parsed = _parse_ringnummer(ringnummer)
    if parsed is None:
        return _ResolvedRow(row_num, error=f"Ungültige Ringnummer: {ringnummer!r}.")
    ring_size, ring_number = parsed

    datum = _cell(values, header_index, "Datum")
    if _is_blank(datum):
        return _ResolvedRow(row_num, error="Datum fehlt.")
    date_time = _combine_datetime(datum, _cell(values, header_index, "Uhrzeit"))
    if date_time is None:
        return _ResolvedRow(row_num, error="Ungültiges Datum bzw. Uhrzeit.")

    art = text("Art")
    if not art:
        return _ResolvedRow(row_num, error="Art fehlt.")
    species = resolver.species(art)
    if species is None:
        return _ResolvedRow(row_num, error=f"Unbekannte Art (nicht in der Artenliste): {art!r}.")

    kuerzel = text("BeringerIn")
    if not kuerzel:
        return _ResolvedRow(row_num, error="Beringer:in fehlt.")
    staff = resolver.beringer.get(kuerzel)
    if staff is None:
        return _ResolvedRow(row_num, error=f"Unbekannte:r Beringer:in: {kuerzel!r}.")

    station = resolver.station(text("Ortskodierung"), text("Ort"))
    if station is None:
        return _ResolvedRow(row_num, error="Unbekannte Station.")

    kwargs = {
        "species": species,
        "ring_size": ring_size,
        "ring_number": ring_number,
        "staff": staff,
        "ringing_station": station,
        # Server-authoritative: the capture lands in the Projekt's Organisation,
        # never a client-chosen one (ADR 0005).
        "organization": project.organization,
        "project": project,
        "date_time": date_time,
        "comment": text("Bemerkungen"),
        "bird_status": _RINGSTATUS.get((text("Ringstatus") or "").upper()),
        "sex": _GESCHLECHT.get((text("Geschlecht") or "").upper()),
        "age_class": _parse_int(_cell(values, header_index, "Alter")),
    }
    return _ResolvedRow(row_num, kwargs=kwargs)


def _cell(values, header_index, header):
    idx = header_index.get(header)
    if idx is None or idx >= len(values):
        return None
    return values[idx]


def _clean(value):
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _is_blank(value):
    return value is None or (isinstance(value, str) and not value.strip())


def _parse_ringnummer(value):
    """Split an authentic Ringnummer (``V00604``) into ``(size, number)``.

    The size is the leading alphabetic run (matched greedily, so two-letter sizes
    like ``SA`` win over ``S``); the number is the trailing digits, kept as a
    string so leading zeros survive (ADR 0006). Returns ``None`` when the format
    is unparseable or the size is not a known Austrian ring size."""
    match = _RINGNUMMER_RE.match(value)
    if not match:
        return None
    size = match.group(1).upper()
    if size not in _VALID_RING_SIZES:
        return None
    return size, match.group(2)


def _combine_datetime(datum, uhrzeit):
    """Combine the sheet's Datum + Uhrzeit into an aware datetime whose wall clock
    is what the ringer recorded. The naive value is localised to the project
    timezone (Europe/Vienna), the inverse of the export's ``localtime`` display —
    so a Datum/Uhrzeit round-trips to the same wall clock (issue #120 AC)."""
    date_part = _to_date(datum)
    if date_part is None:
        return None
    naive = datetime.combine(date_part, _to_time(uhrzeit) or time(0, 0))
    return make_aware(naive)


def _to_date(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return None


def _to_time(value):
    if isinstance(value, datetime):
        return value.time()
    if isinstance(value, time):
        return value
    return None


def _parse_int(value):
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
