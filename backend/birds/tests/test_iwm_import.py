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

from datetime import date, datetime, time
from io import BytesIO

import openpyxl
import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils.timezone import localtime, make_aware

from birds.models import DataEntry, Project, Ring

PROJECTS_URL = "/api/birds/projects/"

# The authentic IWM "Fangdaten" header row (a superset is fine; the importer
# reads the columns it needs by name), mirroring the export/sample layout.
HEADERS = [
    "Ring",
    "Ringnummer",
    "Ringstatus",
    "Art",
    "Geschlecht",
    "Alter",
    "Datum",
    "Uhrzeit",
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


# --- Duplicate detection & recapture (issue #122) -----------------------------
# A row is a duplicate when a capture already exists in the Organisation with the
# same capture key = (ring size + number, date + time). Duplicates are skipped
# (never re-inserted) and counted; an Erstfang and its later Wiederfang share a
# ring but differ by datetime, so both import; re-importing an already-loaded
# file recognises every row as a duplicate, making fix-a-few-and-re-import safe.


def _seed_capture(
    species,
    scientist,
    ringing_station,
    project,
    organization,
    *,
    size="V",
    number="00604",
    when=datetime(2026, 6, 30, 8, 15),
):
    """An existing capture in tenant A whose capture key (ring size+number,
    Datum+Uhrzeit) a matching import row must recognise as a duplicate. Its
    datetime is stored the way the importer combines Datum+Uhrzeit — the sheet's
    Vienna wall clock — so the round-trip key matches exactly."""
    ring = Ring.objects.create(size=size, number=number, organization=organization)
    return DataEntry.objects.create(
        species=species,
        ring=ring,
        staff=scientist,
        ringing_station=ringing_station,
        project=project,
        organization=organization,
        date_time=make_aware(when),
    )


@pytest.mark.django_db
def test_duplicate_row_by_capture_key_is_reported_and_writes_nothing(
    auth_client, scientist, ringing_station, project, species, organization
):
    # A capture with this exact ring (V00604) and datetime already exists.
    _seed_capture(species, scientist, ringing_station, project, organization)
    content = _workbook([_valid_row(species, scientist, ringing_station)])

    body = auth_client.post(
        _import_url(project), {"file": _upload(content)}, format="multipart"
    ).json()

    assert body["importable"] == 0
    assert body["duplicates"] == 1
    assert body["errors"] == []
    # The dry-run wrote nothing — still just the one pre-existing capture.
    assert DataEntry.objects.count() == 1


@pytest.mark.django_db
def test_commit_skips_duplicate_and_reports_duplicates_skipped(
    auth_client, scientist, ringing_station, project, species, organization
):
    _seed_capture(species, scientist, ringing_station, project, organization)
    content = _workbook([_valid_row(species, scientist, ringing_station)])

    body = auth_client.post(
        _import_url(project), {"file": _upload(content), "commit": "true"}, format="multipart"
    ).json()

    assert body["created"] == 0
    assert body["duplicatesSkipped"] == 1
    assert body["errors"] == []
    # The duplicate was skipped, not re-inserted — no doubling.
    assert DataEntry.objects.count() == 1


@pytest.mark.django_db
def test_erstfang_and_later_wiederfang_both_import(
    auth_client, scientist, ringing_station, project, species, organization
):
    # Same ring (V00604), different datetime: the Erstfang and its later
    # Wiederfang have distinct capture keys, so neither is a duplicate of the
    # other and both import — recapture history preserved.
    rows = [
        _valid_row(
            species,
            scientist,
            ringing_station,
            Ringstatus="E",
            Datum=date(2026, 6, 30),
            Uhrzeit=time(8, 15),
        ),
        _valid_row(
            species,
            scientist,
            ringing_station,
            Ringstatus="W",
            Datum=date(2026, 7, 15),
            Uhrzeit=time(9, 0),
        ),
    ]
    content = _workbook(rows)

    body = auth_client.post(
        _import_url(project), {"file": _upload(content), "commit": "true"}, format="multipart"
    ).json()

    assert body["created"] == 2
    assert body["duplicatesSkipped"] == 0
    assert DataEntry.objects.count() == 2
    ring = Ring.objects.get(size="V", number="00604", organization=organization)
    assert DataEntry.objects.filter(ring=ring).count() == 2


@pytest.mark.django_db
def test_reimporting_the_same_file_skips_every_row_as_duplicate(
    auth_client, scientist, ringing_station, project, species
):
    # Two distinct captures (different rings). Fix-a-few-and-re-import safety:
    # the second run must recognise every row as already loaded and add nothing.
    rows = [
        _valid_row(species, scientist, ringing_station, Ringnummer="V00604"),
        _valid_row(species, scientist, ringing_station, Ringnummer="V00701"),
    ]
    content = _workbook(rows)

    first = auth_client.post(
        _import_url(project), {"file": _upload(content), "commit": "true"}, format="multipart"
    ).json()
    assert first["created"] == 2
    assert DataEntry.objects.count() == 2

    preview = auth_client.post(
        _import_url(project), {"file": _upload(content)}, format="multipart"
    ).json()
    assert preview["importable"] == 0
    assert preview["duplicates"] == 2

    result = auth_client.post(
        _import_url(project), {"file": _upload(content), "commit": "true"}, format="multipart"
    ).json()
    assert result["created"] == 0
    assert result["duplicatesSkipped"] == 2
    # No doubling — still exactly the two original captures.
    assert DataEntry.objects.count() == 2


@pytest.mark.django_db
def test_two_identical_rows_in_one_file_import_once(
    auth_client, scientist, ringing_station, project, species
):
    # Two rows with the same capture key within a single upload: the first
    # imports, the second is recognised as a duplicate of it — one file never
    # doubles its own data.
    row = _valid_row(species, scientist, ringing_station)
    content = _workbook([dict(row), dict(row)])

    body = auth_client.post(
        _import_url(project), {"file": _upload(content), "commit": "true"}, format="multipart"
    ).json()

    assert body["created"] == 1
    assert body["duplicatesSkipped"] == 1
    assert DataEntry.objects.count() == 1


# --- Projekt-method precedence & non-blocking warnings (issue #124) ------------
# Fangmethode/Lockmittel/Umstand are Projekt properties (ADR 0002), never stored
# per capture. The selected Projekt's values govern; the file's columns are
# informational and drive the warnings channel, which is distinct from the
# blocking errors channel and never stops the import.


@pytest.mark.django_db
def test_homogeneous_file_disagreeing_with_set_method_warns_but_imports(
    auth_client, scientist, ringing_station, project, species
):
    # The Projekt's Fangmethode is set (default "M" — Japannetz). A homogeneous
    # file whose Fangmethode says "H" disagrees: a non-blocking warning is raised,
    # the Projekt value governs, and the import still proceeds.
    assert project.capture_method == Project.CaptureMethod.MIST_NET
    content = _workbook(
        [_valid_row(species, scientist, ringing_station, Fangmethode="H")],
        headers=[*HEADERS, "Fangmethode"],
    )

    preview = auth_client.post(
        _import_url(project), {"file": _upload(content)}, format="multipart"
    ).json()

    assert preview["importable"] == 1
    assert preview["errors"] == []  # the mismatch is a warning, never an error
    assert len(preview["warnings"]) == 1
    warning = preview["warnings"][0]
    assert warning["row"] == 2
    assert "Fangmethode" in warning["reason"]

    # Non-blocking: commit imports the row and leaves the Projekt value untouched.
    result = auth_client.post(
        _import_url(project), {"file": _upload(content), "commit": "true"}, format="multipart"
    ).json()
    assert result["created"] == 1
    project.refresh_from_db()
    assert project.capture_method == Project.CaptureMethod.MIST_NET


@pytest.mark.django_db
def test_unset_projekt_method_is_adopted_from_homogeneous_file(
    auth_client, scientist, ringing_station, project, species
):
    # The Projekt's Lockmittel is unset; a homogeneous file supplies "A" (Futter).
    # There is no conflict — so no warning — and the file's value is adopted onto
    # the Projekt. Adoption is a write, so it happens only on commit.
    project.lure = ""
    project.save(update_fields=["lure"])
    content = _workbook(
        [
            _valid_row(species, scientist, ringing_station, Lockmittel="A"),
            _valid_row(species, scientist, ringing_station, Ringnummer="V00702", Lockmittel="A"),
        ],
        headers=[*HEADERS, "Lockmittel"],
    )

    preview = auth_client.post(
        _import_url(project), {"file": _upload(content)}, format="multipart"
    ).json()
    assert preview["warnings"] == []  # adoption is not a conflict
    project.refresh_from_db()
    assert project.lure == ""  # dry-run adopts nothing

    result = auth_client.post(
        _import_url(project), {"file": _upload(content), "commit": "true"}, format="multipart"
    ).json()
    assert result["created"] == 2
    project.refresh_from_db()
    assert project.lure == "A"


@pytest.mark.django_db
def test_heterogeneous_file_warns_and_stores_no_per_row_method(
    auth_client, scientist, ringing_station, project, species
):
    # The file's Fangmethode differs across rows ("H" then "M"). The model cannot
    # store a per-capture method, so this is a non-blocking warning; both rows
    # still import. The Projekt is left unset to prove a heterogeneous file adopts
    # nothing (it warns instead of guessing which value governs).
    project.capture_method = ""
    project.save(update_fields=["capture_method"])
    content = _workbook(
        [
            _valid_row(species, scientist, ringing_station, Fangmethode="H"),
            _valid_row(species, scientist, ringing_station, Ringnummer="V00703", Fangmethode="M"),
        ],
        headers=[*HEADERS, "Fangmethode"],
    )

    preview = auth_client.post(
        _import_url(project), {"file": _upload(content)}, format="multipart"
    ).json()
    assert preview["importable"] == 2
    assert preview["errors"] == []
    assert len(preview["warnings"]) == 1
    warning = preview["warnings"][0]
    assert warning["row"] == 3  # the row where the value diverges
    assert "Fangmethode" in warning["reason"]

    result = auth_client.post(
        _import_url(project), {"file": _upload(content), "commit": "true"}, format="multipart"
    ).json()
    assert result["created"] == 2
    project.refresh_from_db()
    assert project.capture_method == ""  # heterogeneous file adopts nothing
