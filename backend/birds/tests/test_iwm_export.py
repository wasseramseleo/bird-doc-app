from datetime import UTC, datetime
from io import BytesIO

import openpyxl
import pytest

from birds.iwm_export import SHEET_NAME, build_iwm_workbook
from birds.models import DataEntry, Ring


def _read_rows(content):
    """Return {header: value} for the first data row of the exported workbook."""
    wb = openpyxl.load_workbook(BytesIO(content))
    ws = wb[SHEET_NAME]
    headers = {
        ws.cell(row=1, column=c).value: c
        for c in range(1, ws.max_column + 1)
        if ws.cell(row=1, column=c).value
    }
    return {header: ws.cell(row=2, column=col).value for header, col in headers.items()}


@pytest.mark.django_db
def test_sentinel_entry_exports_art_and_blank_bird_columns(
    sentinel_species, scientist, ringing_station
):
    ring = Ring.objects.create(number="601", size=Ring.RingSizes.V)
    DataEntry.objects.create(
        species=sentinel_species,
        ring=ring,
        staff=scientist,
        ringing_station=ringing_station,
        date_time=datetime(2026, 2, 1, 8, 0, tzinfo=UTC),
        bird_status=None,
        age_class=None,
        sex=None,
        comment="Produktionsfehler",
    )

    row = _read_rows(build_iwm_workbook(DataEntry.objects.all()))

    assert row["Art"] == "Ring Vernichtet"
    assert row["Ringstatus"] is None
    assert row["Alter"] is None
    assert row["Geschlecht"] is None
    assert row["Bemerkungen"] == "Produktionsfehler"
