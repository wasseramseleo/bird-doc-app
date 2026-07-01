from datetime import UTC, datetime, time
from decimal import Decimal
from io import BytesIO

import openpyxl
import pytest

from birds.iwm_export import SHEET_NAME, build_iwm_workbook
from birds.models import DataEntry, Ring, RingingStation

STATIONS_URL = "/api/birds/ringing-stations/"


def _read_all_rows(content):
    """Return a list of {header: value} dicts, one per data row, in sheet order."""
    wb = openpyxl.load_workbook(BytesIO(content))
    ws = wb[SHEET_NAME]
    headers = {
        ws.cell(row=1, column=c).value: c
        for c in range(1, ws.max_column + 1)
        if ws.cell(row=1, column=c).value
    }
    rows = []
    for r in range(2, ws.max_row + 1):
        if all(ws.cell(row=r, column=col).value is None for col in headers.values()):
            continue
        rows.append({header: ws.cell(row=r, column=col).value for header, col in headers.items()})
    return rows


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
def test_export_emits_vienna_localtime_for_datum_and_uhrzeit(species, scientist, ringing_station):
    # 23:00 UTC is 01:00 the next day in Vienna (CEST, UTC+2). Both the date
    # and the time must reflect the Vienna wall clock the Beringer observed.
    DataEntry.objects.create(
        species=species,
        ring=Ring.objects.create(number="604", size=Ring.RingSizes.V),
        staff=scientist,
        ringing_station=ringing_station,
        date_time=datetime(2026, 6, 30, 23, 0, tzinfo=UTC),
    )

    row = _read_rows(build_iwm_workbook(DataEntry.objects.all()))

    assert row["Datum"] == datetime(2026, 7, 1, 0, 0)
    assert row["Uhrzeit"] == time(1, 0)


@pytest.mark.django_db
def test_export_fills_land_from_station(species, scientist, ringing_station):
    ringing_station.country = "Austria"
    ringing_station.save()
    ring = Ring.objects.create(number="700", size=Ring.RingSizes.V)
    DataEntry.objects.create(
        species=species,
        ring=ring,
        staff=scientist,
        ringing_station=ringing_station,
        date_time=datetime(2026, 2, 1, 8, 0, tzinfo=UTC),
    )

    row = _read_rows(build_iwm_workbook(DataEntry.objects.all()))

    assert row["Land"] == "Austria"


@pytest.mark.django_db
def test_export_fills_region_and_ortskodierung_from_station(species, scientist, ringing_station):
    ringing_station.region = "Oberösterreich"
    ringing_station.place_code = "AU03"
    ringing_station.save()
    ring = Ring.objects.create(number="701", size=Ring.RingSizes.V)
    DataEntry.objects.create(
        species=species,
        ring=ring,
        staff=scientist,
        ringing_station=ringing_station,
        date_time=datetime(2026, 2, 1, 8, 0, tzinfo=UTC),
    )

    row = _read_rows(build_iwm_workbook(DataEntry.objects.all()))

    assert row["Region"] == "Oberösterreich"
    assert row["Ortskodierung"] == "AU03"


@pytest.mark.django_db
def test_export_geo_coordinates_as_lat_lon_with_dot_separator(species, scientist, ringing_station):
    ringing_station.latitude = Decimal("48.295892")
    ringing_station.longitude = Decimal("14.276697")
    ringing_station.save()
    ring = Ring.objects.create(number="702", size=Ring.RingSizes.V)
    DataEntry.objects.create(
        species=species,
        ring=ring,
        staff=scientist,
        ringing_station=ringing_station,
        date_time=datetime(2026, 2, 1, 8, 0, tzinfo=UTC),
    )

    row = _read_rows(build_iwm_workbook(DataEntry.objects.all()))

    assert row["Geo-Koordinaten"] == "48.295892, 14.276697"


@pytest.mark.django_db
def test_export_populates_geography_for_station_created_through_api(
    auth_client, scientist, organization, species
):
    # A Station created through the org-admin API with the required geo fields
    # carries them all the way into the IWM export (issues #114/#118).
    create = auth_client.post(
        STATIONS_URL,
        {
            "name": "Auwald Süd",
            "region": "Oberösterreich",
            "place_code": "AU03",
            "latitude": "48.295892",
            "longitude": "14.276697",
            "country": "Austria",
        },
        format="json",
    )
    assert create.status_code == 201, create.json()
    station = RingingStation.objects.get(handle=create.json()["handle"])

    DataEntry.objects.create(
        species=species,
        ring=Ring.objects.create(number="750", size=Ring.RingSizes.V),
        staff=scientist,
        ringing_station=station,
        date_time=datetime(2026, 2, 1, 8, 0, tzinfo=UTC),
    )

    row = _read_rows(build_iwm_workbook(DataEntry.objects.all()))

    assert row["Land"] == "Austria"
    assert row["Region"] == "Oberösterreich"
    assert row["Ortskodierung"] == "AU03"
    assert row["Geo-Koordinaten"] == "48.295892, 14.276697"


@pytest.mark.django_db
def test_export_fills_capture_context_from_project_defaults(
    species, scientist, ringing_station, project
):
    ring = Ring.objects.create(number="703", size=Ring.RingSizes.V)
    DataEntry.objects.create(
        species=species,
        ring=ring,
        staff=scientist,
        ringing_station=ringing_station,
        project=project,
        date_time=datetime(2026, 2, 1, 8, 0, tzinfo=UTC),
    )

    row = _read_rows(build_iwm_workbook(DataEntry.objects.all()))

    assert row["Umstand"] == "25"
    assert row["Fangmethode"] == "M"
    assert row["Lockmittel"] == "N"


@pytest.mark.django_db
def test_multi_station_project_exports_each_entrys_own_station_geography(
    species, scientist, ringing_station, organization, project
):
    ringing_station.country = "Austria"
    ringing_station.place_code = "AU03"
    ringing_station.save()
    other_station = RingingStation.objects.create(
        handle="STN2",
        name="Second Station",
        organization=organization,
        country="Germany",
        place_code="DE07",
    )
    for idx, station in enumerate((ringing_station, other_station)):
        DataEntry.objects.create(
            species=species,
            ring=Ring.objects.create(number=f"80{idx}", size=Ring.RingSizes.V),
            staff=scientist,
            ringing_station=station,
            project=project,
            date_time=datetime(2026, 2, 1, 8, idx, tzinfo=UTC),
        )

    rows = _read_all_rows(build_iwm_workbook(DataEntry.objects.order_by("date_time")))

    assert [(r["Land"], r["Ortskodierung"]) for r in rows] == [
        ("Austria", "AU03"),
        ("Germany", "DE07"),
    ]


@pytest.mark.django_db
def test_deferred_columns_remain_blank(species, scientist, ringing_station, project):
    ringing_station.country = "Austria"
    ringing_station.save()
    DataEntry.objects.create(
        species=species,
        ring=Ring.objects.create(number="900", size=Ring.RingSizes.V),
        staff=scientist,
        ringing_station=ringing_station,
        project=project,
        has_brood_patch=True,
        date_time=datetime(2026, 2, 1, 8, 0, tzinfo=UTC),
    )

    row = _read_rows(build_iwm_workbook(DataEntry.objects.all()))

    for column in ("Zusatzmarkierung", "Zustand", "Brutfleck", "Kloake"):
        assert row[column] is None


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
