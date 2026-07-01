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
not yet populate (``duplicates``, ``warnings``, ``cap``) are present but
empty/zero.

Unfamiliar Beringer and Stationen are auto-created rather than rejected (issue
#121). An unfamiliar Kürzel (resolved within the Organisation) becomes a
no-account Beringer (ADR 0001); an unfamiliar Ort (resolved by Ortskodierung /
name) becomes a Station built from the sheet's name / Ortskodierung / Region /
Land / coordinates. Every such creation is surfaced in the preview's
``toCreate`` for the Admin to approve, created only on commit (nothing on
dry-run), reported in ``ImportResult.{createdBeringer, createdStationen}``, and
attached to the captures that referenced it.

Scope of this slice: core columns only (species, ring size+number, Beringer
Kürzel, Station, Datum+Uhrzeit, Ringstatus, Geschlecht, Alter). An unknown
species and a missing required field (no ring number / no date) are blocking
errors. Duplicate detection, the row cap, warnings/method precedence,
Sonderarten and full biometric fidelity arrive in later slices.
"""

import re
from datetime import date, datetime, time
from decimal import Decimal, InvalidOperation
from io import BytesIO

import openpyxl
from django.db import transaction
from django.utils.timezone import make_aware

from .capture_service import CaptureValidationError, create_capture
from .models import DataEntry, Ring, RingingStation, Scientist, Species
from .station_handle import derive_station_handle

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
    ``ImportPreview``. Writes nothing — the unfamiliar Beringer and Stationen it
    would create are listed in ``toCreate`` but not yet created."""
    rows, resolver = _analyze(content, project, create=False)
    importable = [r for r in rows if r.error is None]
    errors = [{"row": r.row, "reason": r.error} for r in rows if r.error is not None]
    return {
        "importable": len(importable),
        "duplicates": 0,
        "errors": errors,
        "warnings": [],
        "toCreate": {
            "beringer": resolver.created_beringer,
            "stationen": resolver.created_stationen,
        },
        "cap": {"limit": ROW_CAP, "exceeded": len(rows) > ROW_CAP},
    }


@transaction.atomic
def commit_import(content, project):
    """Commit: create every importable capture atomically, skipping blocking-error
    rows, and return an ``ImportResult``. All-or-nothing — an unexpected failure
    rolls the whole import back. Unfamiliar Beringer and Stationen are created as
    part of the same transaction and reported in ``createdBeringer`` /
    ``createdStationen``."""
    rows, resolver = _analyze(content, project, create=True)
    created = 0
    errors = []
    for resolved in rows:
        if resolved.error is not None:
            errors.append({"row": resolved.row, "reason": resolved.error})
            continue
        try:
            create_capture(**resolved.kwargs)
            created += 1
        except CaptureValidationError as exc:
            errors.append({"row": resolved.row, "reason": str(exc.message)})
    return {
        "created": created,
        "duplicatesSkipped": 0,
        "errors": errors,
        "createdBeringer": resolver.created_beringer,
        "createdStationen": resolver.created_stationen,
    }


class _ResolvedRow:
    """One data row resolved to either capture kwargs (``error is None``) or a
    blocking ``error`` reason, tagged with its 1-based sheet row number."""

    __slots__ = ("row", "kwargs", "error")

    def __init__(self, row, kwargs=None, error=None):
        self.row = row
        self.kwargs = kwargs
        self.error = error


class _RowError(Exception):
    """A per-row resolution failure raised from inside the resolver — an
    auto-create blocked by a constraint (e.g. a Kürzel already owned by another
    Organisation, ``Scientist.handle`` being globally unique). Caught in
    ``_resolve_row`` and turned into a blocking ``_ResolvedRow`` error so one bad
    row never aborts the whole atomic import."""

    def __init__(self, reason):
        self.reason = reason
        super().__init__(reason)


class _Resolver:
    """Org-scoped entity lookups, built once per import so row resolution does not
    re-query. Beringer and Stationen are small (org-scoped); species is looked up
    lazily and cached because the global table is huge.

    An unfamiliar Beringer (by Kürzel) or Station (by Ortskodierung / name) is
    *auto-created* rather than rejected (issue #121). ``create`` decides whether a
    resolution actually writes: a dry-run (``create=False``) only records what it
    *would* create in ``created_beringer`` / ``created_stationen``; a commit
    (``create=True``) creates the entity once and caches it so every referencing
    row shares it. Either way each unfamiliar entity is surfaced exactly once, in
    first-seen order.
    """

    def __init__(self, project, *, create):
        self.project = project
        self.org = project.organization
        self.create = create
        self.beringer = {
            s.handle: s for s in Scientist.objects.filter(organization=self.org) if s.handle
        }
        stations = list(RingingStation.objects.filter(organization=self.org))
        self.station_by_code = {s.place_code: s for s in stations if s.place_code}
        self.station_by_name = {s.name: s for s in stations if s.name}
        self._species_cache = {}
        # Auto-creations surfaced in the preview / result (first-seen order,
        # deduplicated): the Kürzel of new Beringer and the names of new Stationen.
        self.created_beringer = []
        self.created_stationen = []
        # Per-import caches so a repeated unfamiliar reference resolves to the one
        # entity (a shared object on commit; ``None`` placeholder on dry-run).
        self._new_beringer = {}
        self._new_station = {}

    def species(self, common_name_de):
        if common_name_de not in self._species_cache:
            self._species_cache[common_name_de] = Species.objects.filter(
                common_name_de=common_name_de
            ).first()
        return self._species_cache[common_name_de]

    def beringer_for(self, kuerzel):
        """Resolve a Kürzel to its Beringer, auto-creating an unfamiliar one.

        A familiar Kürzel resolves to the existing org Beringer. An unfamiliar one
        is recorded in ``created_beringer`` (once) and, on commit, created as a
        no-account Beringer scoped to the Organisation (ADR 0001); on a dry-run
        nothing is written and ``None`` stands in as a placeholder.

        The familiarity map is org-scoped, but ``Scientist.handle`` is *globally*
        unique (models.py): a Kürzel already owned by a Beringer in another
        Organisation is unfamiliar here yet cannot be auto-created without
        violating that constraint. Rather than let the ``IntegrityError`` abort
        the whole atomic import (HTTP 500), such a row is a blocking error
        (``_RowError``) — the same for a dry-run preview and a commit."""
        existing = self.beringer.get(kuerzel)
        if existing is not None:
            return existing
        if kuerzel not in self._new_beringer:
            if Scientist.objects.filter(handle=kuerzel).exists():
                raise _RowError(
                    f"Beringer:in-Kürzel {kuerzel!r} ist bereits in einer anderen "
                    "Organisation vergeben und kann nicht angelegt werden."
                )
            self.created_beringer.append(kuerzel)
            self._new_beringer[kuerzel] = (
                Scientist.objects.create(handle=kuerzel, organization=self.org)
                if self.create
                else None
            )
        return self._new_beringer[kuerzel]

    def station_for(self, descriptors):
        """Resolve a Station by Ortskodierung / name, auto-creating an unfamiliar
        one from the sheet's descriptors.

        A Station is familiar when its Ortskodierung, or failing that its name,
        matches an existing org Station. An unfamiliar one is recorded in
        ``created_stationen`` (once, by name) and, on commit, created scoped to the
        Organisation from the sheet's name / Ortskodierung / Region / Land /
        coordinates; on a dry-run nothing is written."""
        place_code = descriptors["place_code"]
        name = descriptors["name"]
        if place_code and place_code in self.station_by_code:
            return self.station_by_code[place_code]
        if name and name in self.station_by_name:
            return self.station_by_name[name]
        key = place_code or name
        if key not in self._new_station:
            self.created_stationen.append(name or place_code)
            self._new_station[key] = self._create_station(descriptors) if self.create else None
        return self._new_station[key]

    def _create_station(self, descriptors):
        name = descriptors["name"] or descriptors["place_code"]
        handle = derive_station_handle(
            self.org, name, taken=lambda h: RingingStation.objects.filter(handle=h).exists()
        )
        station = RingingStation.objects.create(
            handle=handle,
            name=name,
            organization=self.org,
            place_code=descriptors["place_code"] or "",
            region=descriptors["region"] or "",
            country=descriptors["country"] or "",
            latitude=descriptors["latitude"],
            longitude=descriptors["longitude"],
        )
        # Later rows naming the same site resolve to this new Station too.
        if station.place_code:
            self.station_by_code[station.place_code] = station
        self.station_by_name[station.name] = station
        return station


def _analyze(content, project, *, create):
    """Parse the workbook and resolve every data row. Raises ``IwmStructureError``
    for a structurally-wrong file; otherwise returns ``(rows, resolver)`` — a
    ``_ResolvedRow`` per data row (never partial — a bad row becomes an error, not
    an exception) plus the ``_Resolver`` that carries the auto-created Beringer /
    Stationen. ``create`` decides whether unfamiliar entities are actually written
    (commit) or only recorded for the preview (dry-run)."""
    header_index, data_rows = _read_fangdaten(content)
    resolver = _Resolver(project, create=create)
    rows = [
        _resolve_row(values, header_index, row_num, project, resolver)
        for row_num, values in data_rows
    ]
    return rows, resolver


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

    place_code = text("Ortskodierung")
    name = text("Ort")
    if not place_code and not name:
        return _ResolvedRow(row_num, error="Ort bzw. Ortskodierung fehlt.")
    # An unfamiliar Kürzel / Ort is auto-created (issue #121); coordinates for a
    # new Station are parsed from the export's "lat, lon" Geo-Koordinaten. An
    # auto-create blocked by a constraint (e.g. a Kürzel already owned by another
    # Organisation) is a blocking row error, never a crash of the whole import.
    latitude, longitude = _parse_coordinates(text("Geo-Koordinaten"))
    try:
        staff = resolver.beringer_for(kuerzel)
        station = resolver.station_for(
            {
                "place_code": place_code,
                "name": name,
                "region": text("Region"),
                "country": text("Land"),
                "latitude": latitude,
                "longitude": longitude,
            }
        )
    except _RowError as exc:
        return _ResolvedRow(row_num, error=exc.reason)

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


def _parse_coordinates(value):
    """Split the export's ``"lat, lon"`` Geo-Koordinaten (decimal degrees) into
    ``(latitude, longitude)`` as ``Decimal``. Returns ``(None, None)`` when the
    cell is blank or unparseable — coordinates are optional on an auto-created
    Station (issue #121)."""
    if not value:
        return None, None
    parts = value.split(",")
    if len(parts) != 2:
        return None, None
    try:
        return Decimal(parts[0].strip()), Decimal(parts[1].strip())
    except (InvalidOperation, ValueError):
        return None, None
