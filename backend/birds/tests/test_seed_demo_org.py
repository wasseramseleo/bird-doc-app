"""The ``seed_demo_org`` management command (issue #127, PRD #113, ADR 0012/0013).

The demo Referenzprojekt and any ops-assisted over-cap backfill ride the **same**
IWM import service the API exposes (``birds.iwm_import.commit_import``) — the
command is a second caller of that service, never a bespoke loader or a data
migration. These tests assert external behaviour only: the entities and captures
that exist in the ``BDDEMO`` Organisation after the command runs, its idempotency,
that Sonderarten obey the shared service's invariants, and that the command path
imports a file larger than the API row cap (the case the button rejects).
"""

from io import StringIO

import pytest
from django.core.management import call_command

from birds.models import DataEntry, Organization, Project, RingingStation, Scientist

DEMO_HANDLE = "BDDEMO"


def _run(**kwargs):
    """Run the command with its output captured (never printed into the test log)."""
    call_command("seed_demo_org", stdout=StringIO(), stderr=StringIO(), **kwargs)


@pytest.mark.django_db
def test_seeds_bddemo_org_with_projekt_stationen_beringer_and_captures(db):
    _run()

    org = Organization.objects.get(handle=DEMO_HANDLE)
    project = Project.objects.get(organization=org)
    captures = DataEntry.objects.filter(organization=org)

    # The demo content lands in the BDDEMO tenant's Projekt.
    assert captures.count() > 0
    assert all(c.project == project for c in captures)
    # The import auto-created the sheet's Beringer and Stationen in the tenant.
    assert Scientist.objects.filter(organization=org).exists()
    assert RingingStation.objects.filter(organization=org).exists()


@pytest.mark.django_db
def test_second_run_creates_no_duplicate_captures(db):
    # Idempotency (re-runnable local / staging / prod): the importer's
    # duplicate-by-capture-key skip makes a second run add nothing.
    _run()
    org = Organization.objects.get(handle=DEMO_HANDLE)
    after_first = DataEntry.objects.filter(organization=org).count()
    beringer_first = Scientist.objects.filter(organization=org).count()
    station_first = RingingStation.objects.filter(organization=org).count()
    assert after_first > 0

    _run()

    # No doubled captures, no doubled Organisation / Projekt / auto-created entities.
    assert DataEntry.objects.filter(organization=org).count() == after_first
    assert Organization.objects.filter(handle=DEMO_HANDLE).count() == 1
    assert Project.objects.filter(organization=org).count() == 1
    assert Scientist.objects.filter(organization=org).count() == beringer_first
    assert RingingStation.objects.filter(organization=org).count() == station_first


@pytest.mark.django_db
def test_command_imports_a_file_larger_than_the_api_row_cap(monkeypatch, db):
    # Over-cap ops-assisted backfill: the API rejects a file beyond ROW_CAP
    # (issue #125), but the command path loads a multi-year history without a
    # background worker. With the cap lowered far below the sheet's row count the
    # command must still import every row — never truncated, never rejected.
    monkeypatch.setattr("birds.iwm_import.ROW_CAP", 5)

    _run()

    org = Organization.objects.get(handle=DEMO_HANDLE)
    assert DataEntry.objects.filter(organization=org).count() > 5


@pytest.mark.django_db
def test_sonderart_demo_captures_obey_the_shared_services_invariants(
    sentinel_species, aves_ignota_species, db
):
    # The command reuses the same parse → validate → create service as the API
    # (no duplicated ingestion path): the sheet's Sonderarten therefore satisfy
    # exactly the shared invariants (ADR 0004). The sample carries one
    # Ring-Vernichtet row and two Aves-ignota rows.
    _run()
    org = Organization.objects.get(handle=DEMO_HANDLE)

    destroyed = DataEntry.objects.filter(organization=org, species=sentinel_species)
    ignota = DataEntry.objects.filter(organization=org, species=aves_ignota_species)
    assert destroyed.count() == 1
    assert ignota.count() == 2

    # Ring Vernichtet: create_capture nulled every bird-data field but kept the
    # ring identity — the destroyed ring is still recorded (ADR 0004 / ADR 0006).
    ring_vernichtet = destroyed.get()
    assert ring_vernichtet.bird_status is None
    assert ring_vernichtet.age_class is None
    assert ring_vernichtet.sex is None
    assert ring_vernichtet.ring is not None

    # Aves ignota rows imported only because validate_capture's mandatory-Bemerkung
    # rule was satisfied — each keeps a non-empty comment.
    assert all(c.comment for c in ignota)
