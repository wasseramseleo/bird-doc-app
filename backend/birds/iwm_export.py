from io import BytesIO
from pathlib import Path

import openpyxl

TEMPLATE_PATH = (
    Path(__file__).resolve().parent / "templates" / "iwm" / "Datenmeldung_Vorlage_IWM.xlsx"
)
SHEET_NAME = "Fangdaten"
SCHEME_CODE = "AUW"


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
# Headers absent from this map (Zusatzmarkierung, Fangmethode, Lockmittel,
# Ortskodierung, Geo-Koordinaten, Zustand, Umstand, Brutfleck, Kloake, Region,
# Land) are deferred per the task brief and written as empty.
COLUMN_MAP = {
    "Ring": lambda e: SCHEME_CODE,
    "Ringnummer": lambda e: f"{e.ring.size}{e.ring.number}",
    "Ringstatus": lambda e: e.bird_status.upper(),
    "Art": lambda e: e.species.common_name_de,
    "Geschlecht": lambda e: e.sex,
    "Alter": lambda e: e.age_class,
    "Datum": lambda e: e.date_time.date(),
    "Uhrzeit": lambda e: e.date_time.time(),
    "Flügellänge": lambda e: e.wing_span,
    "Teilfederlänge": lambda e: e.feather_span,
    "Gewicht": lambda e: e.weight_gram,
    "Tarsus": lambda e: e.tarsus,
    "Fett": lambda e: e.fat_deposit,
    "Muskel": lambda e: e.muscle_class,
    "Intensität": lambda e: e.small_feather_int,
    "Fortschritt": lambda e: e.small_feather_app,
    "Handschwingen": lambda e: e.hand_wing,
    "Netz": lambda e: e.net_location,
    "Ort": lambda e: e.ringing_station.name if e.ringing_station else None,
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
