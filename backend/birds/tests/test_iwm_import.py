"""IWM import — the end-to-end spine (issue #120, PRD #113).

Seam 1 (primary): the ``import-iwm`` API action. The tests drive it through the
DRF ``APIClient`` with in-test workbooks built the way ``test_iwm_export.py``
builds them, and assert external behaviour only — the HTTP response, the report
contents, and the captures that exist afterwards — never how parsing or
bulk-insert is wired internally.

Scope (this slice): dry-run preview + atomic commit on the same upload,
Admin-only (403 for a plain Mitglied, 404 for a foreign-tenant Projekt),
structural fast-fail, unknown-species / missing-field blocking errors, and
wall-clock Datum/Uhrzeit with Geschlecht ``U/M/W`` + integer Alter understood.
Duplicates, warnings, Sonderarten, auto-created Beringer/Stationen and the row
cap arrive in later slices; unfamiliar Beringer/Stationen are blocking errors
here.
"""

from datetime import date, time
from io import BytesIO
from pathlib import Path

import openpyxl
import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils.timezone import localtime

from birds.models import DataEntry, RingingStation, Scientist

PROJECTS_URL = "/api/birds/projects/"

# The committed authentic-format fixture (Illmitz/Neusiedlersee, 343 rows incl.
# Wiederfänge and the three Sonderart rows). Doubles as an import-feature fixture.
SAMPLE_IWM = Path(__file__).resolve().parent.parent / "demo" / "sample_iwm_illmitz.xlsx"

# The authentic IWM "Fangdaten" header row (a superset is fine; the importer
# reads the columns it needs by name), mirroring the export/sample layout. It
# carries the authentic category-code columns (Fett/Muskel/Intensität/
# Handschwingen/Netz) and Zusatzmarkierung so a test can drive full code fidelity.
HEADERS = [
    "Ring",
    "Ringnummer",
    "Ringstatus",
    "Zusatzmarkierung",
    "Art",
    "Geschlecht",
    "Alter",
    "Datum",
    "Uhrzeit",
    "Fett",
    "Muskel",
    "Intensität",
    "Handschwingen",
    "Netz",
    "Ortskodierung",
    "Ort",
    "Region",
    "Land",
    "Bemerkungen",
    "BeringerIn",
]


def _valid_row(species, scientist, ringing_station, **overrides):
    """A structurally-complete, resolvable Fangdaten row for tenant A."""
    row = {
        "Ring": "AUW",
        "Ringnummer": "V00604",
        "Ringstatus": "E",
        "Art": species.common_name_de,
        "Geschlecht": "U",
        "Alter": 3,
        "Datum": date(2026, 6, 30),
        "Uhrzeit": time(8, 15),
        "Ortskodierung": ringing_station.place_code or "",
        "Ort": ringing_station.name,
        "Region": "Burgenland",
        "Land": "Austria",
        "Bemerkungen": "",
        "BeringerIn": scientist.handle,
    }
    row.update(overrides)
    return row


def _workbook(rows, *, headers=HEADERS, sheet_name="Fangdaten"):
    """Serialise ``rows`` (list of {header: value}) into .xlsx bytes."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = sheet_name
    ws.append(headers)
    col = {h: i + 1 for i, h in enumerate(headers)}
    for r_i, row in enumerate(rows, start=2):
        for h, c in col.items():
            value = row.get(h)
            if value not in (None, ""):
                ws.cell(row=r_i, column=c, value=value)
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _upload(content, name="import.xlsx"):
    return SimpleUploadedFile(
        name,
        content,
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


def _import_url(project):
    return f"{PROJECTS_URL}{project.id}/import-iwm/"


@pytest.mark.django_db
def test_dry_run_returns_preview_and_writes_nothing(
    auth_client, scientist, ringing_station, project, species
):
    content = _workbook([_valid_row(species, scientist, ringing_station)])

    response = auth_client.post(
        _import_url(project), {"file": _upload(content)}, format="multipart"
    )

    assert response.status_code == 200, response.content
    body = response.json()
    assert body["importable"] == 1
    assert body["errors"] == []
    # A dry-run writes nothing — not a single capture.
    assert DataEntry.objects.count() == 0


@pytest.mark.django_db
def test_commit_creates_importable_captures_scoped_to_project_org(
    auth_client, scientist, ringing_station, project, species, organization
):
    content = _workbook([_valid_row(species, scientist, ringing_station)])

    response = auth_client.post(
        _import_url(project), {"file": _upload(content), "commit": "true"}, format="multipart"
    )

    assert response.status_code == 200, response.content
    body = response.json()
    assert body["created"] == 1
    assert body["errors"] == []

    entry = DataEntry.objects.get()
    assert entry.species == species
    assert entry.staff == scientist
    assert entry.ringing_station == ringing_station
    assert entry.project == project
    assert entry.ring.size == "V"
    assert entry.ring.number == "00604"
    # Server-authoritative: scoped to the Projekt's Organisation, and its Ring is
    # created within that Organisation (ADR 0005, 0006).
    assert entry.organization == organization
    assert entry.ring.organization == organization


@pytest.mark.django_db
def test_commit_understands_geschlecht_letters_ringstatus_and_integer_alter(
    auth_client, scientist, ringing_station, project, species
):
    content = _workbook(
        [
            _valid_row(
                species,
                scientist,
                ringing_station,
                Ringnummer="V00701",
                Geschlecht="W",
                Alter=5,
                Ringstatus="W",
            )
        ]
    )

    response = auth_client.post(
        _import_url(project), {"file": _upload(content), "commit": "true"}, format="multipart"
    )

    assert response.status_code == 200, response.content
    entry = DataEntry.objects.get()
    assert entry.sex == DataEntry.Sex.FEMALE
    assert entry.age_class == 5
    assert entry.bird_status == DataEntry.BirdStatus.RE_CATCH


@pytest.mark.django_db
def test_datum_uhrzeit_import_as_wall_clock(
    auth_client, scientist, ringing_station, project, species
):
    # The sheet records a Vienna wall clock; the stored capture must display back
    # the same Datum/Uhrzeit under the export's localtime (issue #120 AC).
    content = _workbook(
        [
            _valid_row(
                species,
                scientist,
                ringing_station,
                Datum=date(2026, 7, 1),
                Uhrzeit=time(1, 0),
            )
        ]
    )

    response = auth_client.post(
        _import_url(project), {"file": _upload(content), "commit": "true"}, format="multipart"
    )

    assert response.status_code == 200, response.content
    entry = DataEntry.objects.get()
    local = localtime(entry.date_time)
    assert local.date() == date(2026, 7, 1)
    assert local.time() == time(1, 0)


# --- Admin-only (mirrors export-iwm): 403 Mitglied, 404 foreign tenant --------


@pytest.mark.django_db
def test_plain_mitglied_cannot_import(
    mitglied_client, mitglied_scientist, project, scientist, ringing_station, species
):
    # Mara is a member of tenant A but a plain Mitglied: the import is a
    # privileged bulk write, refused with a clear message (never a bare 403).
    project.scientists.add(mitglied_scientist)
    content = _workbook([_valid_row(species, scientist, ringing_station)])

    response = mitglied_client.post(
        _import_url(project), {"file": _upload(content)}, format="multipart"
    )

    assert response.status_code == 403
    assert "Administrator" in response.json().get("detail", "")
    assert DataEntry.objects.count() == 0


@pytest.mark.django_db
def test_foreign_tenant_project_is_404(
    auth_client_b, scientist_b, project, scientist, ringing_station, species
):
    # Bruno is an Admin of tenant B; tenant A's Projekt is invisible to him, so
    # importing into it is a 404 (the row is absent), not a 403.
    content = _workbook([_valid_row(species, scientist, ringing_station)])

    response = auth_client_b.post(
        _import_url(project), {"file": _upload(content), "commit": "true"}, format="multipart"
    )

    assert response.status_code == 404
    assert DataEntry.objects.count() == 0


# --- Structural fast-fail -----------------------------------------------------


@pytest.mark.django_db
def test_missing_fangdaten_sheet_fails_fast(auth_client, scientist, project):
    content = _workbook([{}], sheet_name="Tabelle1")

    response = auth_client.post(
        _import_url(project), {"file": _upload(content)}, format="multipart"
    )

    assert response.status_code == 400
    assert "Fangdaten" in str(response.json())


@pytest.mark.django_db
def test_missing_required_header_fails_fast(
    auth_client, scientist, ringing_station, project, species
):
    headers = [h for h in HEADERS if h != "Ringnummer"]
    content = _workbook([_valid_row(species, scientist, ringing_station)], headers=headers)

    response = auth_client.post(
        _import_url(project), {"file": _upload(content)}, format="multipart"
    )

    assert response.status_code == 400
    assert "Ringnummer" in str(response.json())


# --- Per-row blocking errors --------------------------------------------------


@pytest.mark.django_db
def test_unknown_species_is_a_blocking_error(
    auth_client, scientist, ringing_station, project, species
):
    rows = [
        _valid_row(species, scientist, ringing_station),  # row 2 — importable
        _valid_row(
            species,
            scientist,
            ringing_station,
            Ringnummer="V00777",
            Art="Ferkelvogel Nichtexistent",
        ),  # row 3 — unknown species
    ]
    content = _workbook(rows)

    preview = auth_client.post(
        _import_url(project), {"file": _upload(content)}, format="multipart"
    ).json()

    assert preview["importable"] == 1
    assert [e["row"] for e in preview["errors"]] == [3]
    assert "Ferkelvogel" in preview["errors"][0]["reason"]
    assert DataEntry.objects.count() == 0

    # On commit the bad row is skipped, the good one imported.
    result = auth_client.post(
        _import_url(project), {"file": _upload(content), "commit": "true"}, format="multipart"
    ).json()
    assert result["created"] == 1
    assert [e["row"] for e in result["errors"]] == [3]
    assert DataEntry.objects.count() == 1


@pytest.mark.django_db
def test_missing_ring_number_and_missing_date_are_blocking_errors(
    auth_client, scientist, ringing_station, project, species
):
    rows = [
        _valid_row(species, scientist, ringing_station, Ringnummer=""),  # row 2
        _valid_row(species, scientist, ringing_station, Ringnummer="V00888", Datum=""),  # row 3
    ]
    content = _workbook(rows)

    preview = auth_client.post(
        _import_url(project), {"file": _upload(content)}, format="multipart"
    ).json()

    assert preview["importable"] == 0
    reasons = {e["row"]: e["reason"] for e in preview["errors"]}
    assert set(reasons) == {2, 3}
    assert "Ringnummer" in reasons[2]
    assert "Datum" in reasons[3]


@pytest.mark.django_db
def test_unfamiliar_beringer_and_station_are_blocking_errors_this_slice(
    auth_client, scientist, ringing_station, project, species
):
    # Scope note (issue #120): auto-create of unfamiliar Beringer/Stationen is a
    # later slice; here they are blocking errors so nothing is silently created.
    rows = [
        _valid_row(species, scientist, ringing_station, BeringerIn="XYZ"),  # row 2
        _valid_row(
            species,
            scientist,
            ringing_station,
            Ringnummer="V00999",
            Ort="Nirgendwo",
            Ortskodierung="ZZ99",
        ),  # row 3
    ]
    content = _workbook(rows)

    preview = auth_client.post(
        _import_url(project), {"file": _upload(content)}, format="multipart"
    ).json()

    assert preview["importable"] == 0
    reasons = {e["row"]: e["reason"] for e in preview["errors"]}
    assert "Beringer" in reasons[2]
    assert "Station" in reasons[3]


# --- Authentic IWM codes beyond the spine (issue #123) ------------------------


@pytest.mark.django_db
def test_commit_ingests_authentic_category_codes(
    auth_client, scientist, ringing_station, project, species
):
    # The authentic sheet carries the category fields as text codes (Fett, Muskel,
    # Intensität, Handschwingen) and the net number (Netz); Zusatzmarkierung="ZZ"
    # (no additional marking) rides along. Each lands in its model field.
    content = _workbook(
        [
            _valid_row(
                species,
                scientist,
                ringing_station,
                Zusatzmarkierung="ZZ",
                Fett="4",
                Muskel="2",
                Intensität="1",
                Handschwingen="3",
                Netz="7",
            )
        ]
    )

    response = auth_client.post(
        _import_url(project), {"file": _upload(content), "commit": "true"}, format="multipart"
    )

    assert response.status_code == 200, response.content
    assert response.json()["created"] == 1
    entry = DataEntry.objects.get()
    assert entry.fat_deposit == 4
    assert entry.muscle_class == 2
    assert entry.small_feather_int == 1
    assert entry.hand_wing == 3
    assert entry.net_location == 7


# --- Sonderarten (issue #123) -------------------------------------------------


@pytest.mark.django_db
def test_ring_vernichtet_imports_with_bird_data_nulled_and_ring_preserved(
    auth_client, scientist, ringing_station, project, sentinel_species
):
    # A destroyed-ring row still consumes its Ring identity but carries no bird
    # data: whatever codes ride along on the row are forced null server-side
    # (ADR 0004), and its Ringnummer is preserved as-is.
    content = _workbook(
        [
            _valid_row(
                sentinel_species,
                scientist,
                ringing_station,
                Ringnummer="V04211",
                Ringstatus="",
                Geschlecht="",
                Alter="",
                Fett="3",
                Muskel="2",
                Netz="4",
                Bemerkungen="Ring beim Anlegen deformiert, vernichtet",
            )
        ]
    )

    response = auth_client.post(
        _import_url(project), {"file": _upload(content), "commit": "true"}, format="multipart"
    )

    assert response.status_code == 200, response.content
    assert response.json()["created"] == 1
    entry = DataEntry.objects.get()
    assert entry.species == sentinel_species
    # Ring identity preserved as-is (ADR 0006) — no renumbering.
    assert entry.ring.size == "V"
    assert entry.ring.number == "04211"
    # Every bird-data field nulled, whatever the sheet carried.
    assert entry.sex is None
    assert entry.age_class is None
    assert entry.bird_status is None
    assert entry.fat_deposit is None
    assert entry.muscle_class is None
    assert entry.net_location is None


@pytest.mark.django_db
def test_aves_ignota_requires_bemerkung_blank_is_blocking_error(
    auth_client, scientist, ringing_station, project, aves_ignota_species
):
    # An unlisted rarity (Aves ignota) must always be described: a row with a
    # Bemerkung imports; one with a blank Bemerkung is a blocking error — visible
    # already in the dry-run preview and skipped on commit (ADR 0004).
    rows = [
        _valid_row(
            aves_ignota_species,
            scientist,
            ringing_station,
            Ringnummer="V05001",
            Bemerkungen="Unbestimmter Acrocephalus, Fotos an Vogelwarte",
        ),  # row 2 — importable
        _valid_row(
            aves_ignota_species,
            scientist,
            ringing_station,
            Ringnummer="V05002",
            Bemerkungen="",
        ),  # row 3 — blank Bemerkung, blocking
    ]
    content = _workbook(rows)

    preview = auth_client.post(
        _import_url(project), {"file": _upload(content)}, format="multipart"
    ).json()
    assert preview["importable"] == 1
    assert [e["row"] for e in preview["errors"]] == [3]
    assert "Bemerkung" in preview["errors"][0]["reason"]
    assert DataEntry.objects.count() == 0

    result = auth_client.post(
        _import_url(project), {"file": _upload(content), "commit": "true"}, format="multipart"
    ).json()
    assert result["created"] == 1
    assert [e["row"] for e in result["errors"]] == [3]
    entry = DataEntry.objects.get()
    assert entry.species == aves_ignota_species
    assert entry.comment == "Unbestimmter Acrocephalus, Fotos an Vogelwarte"


@pytest.mark.django_db
def test_sonderart_names_resolve_to_sonderart_rows_not_unknown_species(
    auth_client, scientist, ringing_station, project, sentinel_species, aves_ignota_species
):
    # The Sonderart names are real Species rows, not typos: they resolve to their
    # Sonderart rows and must never be flagged "unknown species (not in the
    # Artenliste)" the way a genuine unlisted name (row 4) is.
    rows = [
        _valid_row(
            sentinel_species,
            scientist,
            ringing_station,
            Ringnummer="V06001",
            Ringstatus="",
            Bemerkungen="vernichtet",
        ),  # row 2 — Ring Vernichtet
        _valid_row(
            aves_ignota_species,
            scientist,
            ringing_station,
            Ringnummer="V06002",
            Bemerkungen="Bestimmung unsicher",
        ),  # row 3 — Aves ignota
        _valid_row(
            species=type("S", (), {"common_name_de": "Ferkelvogel Nichtexistent"})(),
            scientist=scientist,
            ringing_station=ringing_station,
            Ringnummer="V06003",
        ),  # row 4 — genuinely unknown
    ]
    content = _workbook(rows)

    preview = auth_client.post(
        _import_url(project), {"file": _upload(content)}, format="multipart"
    ).json()

    assert preview["importable"] == 2
    assert [e["row"] for e in preview["errors"]] == [4]
    assert "Unbekannte Art" in preview["errors"][0]["reason"]


# --- The committed authentic-IWM fixture (issue #123) -------------------------


def _sonderart_rows_from_fixture():
    """Read the fixture's three Sonderart rows keyed by Ringnummer, so the test
    asserts against the real committed sheet rather than hardcoded values."""
    wb = openpyxl.load_workbook(SAMPLE_IWM, data_only=True)
    ws = wb["Fangdaten"]
    headers = [c.value for c in ws[1]]
    sonderart = {}
    for r in ws.iter_rows(min_row=2):
        row = dict(zip(headers, [c.value for c in r], strict=False))
        if row.get("Art") in ("Ring Vernichtet", "Art nicht in der Liste (Aves ignota)"):
            sonderart[row["Ringnummer"]] = row
    wb.close()
    return sonderart


def _capture_for_ringnummer(ringnummer):
    """The imported capture whose Ring identity is ``ringnummer`` (e.g. ``V18245``)."""
    size = "".join(ch for ch in ringnummer if ch.isalpha())
    number = ringnummer[len(size) :]
    return DataEntry.objects.get(ring__size=size, ring__number=number)


@pytest.mark.django_db
def test_sample_fixture_imports_sonderart_rows_and_authentic_codes(
    auth_client, scientist, project, organization
):
    # The Sonderart rows reference Beringer JGR/MWA/SBA at Stationen NS01/NS02/NS03;
    # pre-seed those so the three rows resolve (auto-create is a later slice).
    for kuerzel in ("JGR", "MWA", "SBA"):
        Scientist.objects.create(handle=kuerzel, organization=organization)
    for code in ("NS01", "NS02", "NS03"):
        RingingStation.objects.create(
            handle=f"ST-{code}", name=f"Illmitz {code}", place_code=code, organization=organization
        )
    fixture = _sonderart_rows_from_fixture()
    assert len(fixture) == 3  # one Ring Vernichtet + two Aves ignota

    upload = _upload(SAMPLE_IWM.read_bytes(), name="sample_iwm_illmitz.xlsx")
    response = auth_client.post(
        _import_url(project),
        {"file": upload, "commit": "true"},
        format="multipart",
    )
    assert response.status_code == 200, response.content

    for ringnummer, sheet_row in fixture.items():
        entry = _capture_for_ringnummer(ringnummer)
        # Ring identity preserved as-is (ADR 0006) — no renumbering.
        assert f"{entry.ring.size}{entry.ring.number}" == ringnummer
        assert entry.species.special_kind  # a Sonderart row, never "unknown species"

        if sheet_row["Art"] == "Ring Vernichtet":
            assert entry.species.special_kind == "ring_destroyed"
            # Bird data nulled server-side despite the sheet carrying a Netz value.
            assert entry.sex is None
            assert entry.age_class is None
            assert entry.bird_status is None
            assert entry.fat_deposit is None
            assert entry.muscle_class is None
            assert entry.net_location is None
        else:
            assert entry.species.special_kind == "unknown_species"
            # Its mandatory Bemerkung and its authentic category codes land intact.
            assert entry.comment == sheet_row["Bemerkungen"]
            assert entry.fat_deposit == int(sheet_row["Fett"])
            assert entry.muscle_class == int(sheet_row["Muskel"])
            assert entry.small_feather_int == int(sheet_row["Intensität"])
            assert entry.hand_wing == int(sheet_row["Handschwingen"])
            assert entry.net_location == int(sheet_row["Netz"])
