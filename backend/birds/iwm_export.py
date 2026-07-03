from io import BytesIO
from pathlib import Path

import openpyxl
from django.utils.timezone import localtime

from .models import DataEntry

TEMPLATE_PATH = (
    Path(__file__).resolve().parent / "templates" / "iwm" / "Datenmeldung_Vorlage_IWM.xlsx"
)
SHEET_NAME = "Fangdaten"

# "No additional marking" — every authentic Datenmeldung row carries it (the
# importer reads and discards it, having no model field to land it in).
ZUSATZMARKIERUNG = "ZZ"

# The model stores Geschlecht as an integer (0/1/2); the authentic sheet carries
# it as a letter (U/M/W). This mapping is the inverse of the importer's, so
# export and import round-trip.
_SEX_TO_CODE = {
    DataEntry.Sex.UNKNOWN: "U",
    DataEntry.Sex.MALE: "M",
    DataEntry.Sex.FEMALE: "W",
}


def _sex_code(entry):
    """The authentic Geschlecht letter for a capture, or ``None`` when unset (a
    Sonderart row carries no sex)."""
    return _SEX_TO_CODE.get(entry.sex)


def _text_code(value):
    """An authentic category code is text in the sheet; write the integer the
    model stores as a string, leaving a blank cell blank."""
    return None if value is None else str(value)


def _geo_coordinates(entry):
    """Format the station's coordinates as ``lat, lon`` decimal degrees (dot separator)."""
    station = entry.ringing_station
    if not station or station.latitude is None or station.longitude is None:
        return None
    return f"{station.latitude}, {station.longitude}"


def _build_comment(entry):
    parts = [entry.comment] if entry.comment else []
    if entry.has_mites:
        parts.append("Milben")
    if entry.has_hunger_stripes:
        parts.append("Hungerstreifen")
    if entry.has_brood_patch:
        parts.append("Brutfleck")
    if entry.has_cpl_plus:
        parts.append("CPL+")
    return " ".join(parts) or None


# IWM header text → callable(entry) -> cell value (None = leave blank).
# Headers absent from this map (Zustand, Brutfleck, Kloake) are still deferred
# per the task brief and written as empty.
COLUMN_MAP = {
    # The ring's own issuing Zentrale — an EURING scheme code, never free prose.
    # The AUW backfill (ADR 0019) guarantees ``central`` is never null, so a
    # domestic ring still emits "AUW" while a foreign ring emits its own scheme
    # code (issue #230, US 20).
    "Ring": lambda e: e.ring.central.scheme_code,
    "Ringnummer": lambda e: f"{e.ring.size}{e.ring.number}",
    "Ringstatus": lambda e: e.bird_status.upper() if e.bird_status else None,
    "Art": lambda e: e.species.common_name_de,
    "Zusatzmarkierung": lambda e: ZUSATZMARKIERUNG,
    "Geschlecht": _sex_code,
    "Alter": lambda e: e.age_class,
    "Datum": lambda e: localtime(e.date_time).date(),
    "Uhrzeit": lambda e: localtime(e.date_time).time(),
    "Flügellänge": lambda e: e.wing_span,
    "Teilfederlänge": lambda e: e.feather_span,
    "Gewicht": lambda e: e.weight_gram,
    "Tarsus": lambda e: e.tarsus,
    "Fett": lambda e: _text_code(e.fat_deposit),
    "Muskel": lambda e: _text_code(e.muscle_class),
    "Intensität": lambda e: _text_code(e.small_feather_int),
    "Fortschritt": lambda e: e.small_feather_app,
    "Handschwingen": lambda e: _text_code(e.hand_wing),
    "Netz": lambda e: _text_code(e.net_location),
    "Ort": lambda e: e.ringing_station.name if e.ringing_station else None,
    "Land": lambda e: e.ringing_station.country or None if e.ringing_station else None,
    "Region": lambda e: e.ringing_station.region or None if e.ringing_station else None,
    "Ortskodierung": (
        lambda e: e.ringing_station.place_code or None if e.ringing_station else None
    ),
    "Geo-Koordinaten": _geo_coordinates,
    "Umstand": lambda e: e.project.circumstance if e.project else None,
    "Fangmethode": lambda e: e.project.capture_method if e.project else None,
    "Lockmittel": lambda e: e.project.lure if e.project else None,
    "Bemerkungen": _build_comment,
    "BeringerIn": lambda e: e.staff.handle,
}


def build_iwm_workbook(entries) -> bytes:
    wb = openpyxl.load_workbook(TEMPLATE_PATH)
    ws = wb[SHEET_NAME]

    header_to_col = {
        ws.cell(row=1, column=c).value: c
        for c in range(1, ws.max_column + 1)
        if ws.cell(row=1, column=c).value
    }
    missing = set(COLUMN_MAP) - set(header_to_col)
    if missing:
        raise RuntimeError(f"IWM template missing columns: {sorted(missing)}")

    # Clear all template data rows in the 32 real columns (deferred ones too),
    # so example rows don't leak into the user's export.
    for r in range(2, ws.max_row + 1):
        for col in header_to_col.values():
            ws.cell(row=r, column=col).value = None

    for row_idx, entry in enumerate(entries, start=2):
        for header, getter in COLUMN_MAP.items():
            ws.cell(row=row_idx, column=header_to_col[header]).value = getter(entry)

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()
