"""Seed the demo Referenzprojekt tenant (BDDEMO) through the shared IWM import
service (issue #127, PRD #113, ADR 0012 / ADR 0013).

The demo Organisation dogfoods the production import path: this command is a
second caller of the very ``birds.iwm_import`` service the ``import-iwm`` API
action exposes — never a bespoke loader and never a data migration. It ensures
the ``BDDEMO`` Organisation and a Projekt exist, then imports an IWM
``Datenmeldung`` sheet into that Projekt via ``commit_import``.

It is idempotent / re-runnable (local, staging, prod): the importer skips rows
whose capture key already exists, so a second run creates no duplicate captures,
and the Organisation / Projekt are get-or-created. During development it runs
against the committed ``sample_iwm_illmitz.xlsx``.
"""

from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from birds.iwm_import import IwmStructureError, commit_import
from birds.models import Organization, Project

DEMO_ORG_HANDLE = "BDDEMO"
DEMO_ORG_NAME = "BirdDoc Demo"
DEMO_PROJECT_TITLE = "Referenzprojekt Neusiedlersee"

# The committed synthetic stand-in for the (later) anonymised ``demo_iwm.xlsx``.
DEFAULT_SAMPLE = Path(__file__).resolve().parents[2] / "demo" / "sample_iwm_illmitz.xlsx"


class Command(BaseCommand):
    help = (
        "Seed the demo Referenzprojekt (Organisation BDDEMO) by importing an IWM "
        "Datenmeldung sheet through the shared import service. Idempotent and "
        "re-runnable."
    )

    def handle(self, *args, **options):
        content = self._read(DEFAULT_SAMPLE)

        org, _ = Organization.objects.get_or_create(
            handle=DEMO_ORG_HANDLE,
            defaults={"name": DEMO_ORG_NAME, "country": "AT"},
        )
        project, _ = Project.objects.get_or_create(
            title=DEMO_PROJECT_TITLE,
            organization=org,
        )

        # ``enforce_cap=False``: this is the sanctioned over-cap path (ADR 0013).
        # The API rejects a file beyond ROW_CAP (issue #125); the command loads a
        # demo seed or a multi-year one-time backfill without a background worker.
        try:
            result = commit_import(content, project, enforce_cap=False)
        except IwmStructureError as exc:
            raise CommandError(str(exc)) from exc

        self._report(org, project, result)

    def _read(self, path):
        try:
            return path.read_bytes()
        except OSError as exc:
            raise CommandError(f"Konnte die Importdatei nicht lesen: {path} ({exc})") from exc

    def _report(self, org, project, result):
        self.stdout.write(
            self.style.SUCCESS(
                f"Demo-Import in Organisation {org.handle} · Projekt „{project.title}“:\n"
                f"  Fänge angelegt:        {result['created']}\n"
                f"  Duplikate übersprungen: {result['duplicatesSkipped']}\n"
                f"  Beringer:innen angelegt: {result['createdBeringer']}\n"
                f"  Stationen angelegt:     {result['createdStationen']}\n"
                f"  Fehlerzeilen:           {len(result['errors'])}"
            )
        )
