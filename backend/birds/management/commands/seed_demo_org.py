"""Seed the demo Referenzprojekt tenant (BDDEMO) through the shared IWM import
service (issue #127, PRD #113, ADR 0012 / ADR 0013).

The demo Organisation dogfoods the production import path: this command is a
second caller of the very ``birds.iwm_import`` service the ``import-iwm`` API
action exposes — never a bespoke loader and never a data migration. It ensures
the ``BDDEMO`` Organisation and a Projekt exist, then imports an IWM
``Datenmeldung`` sheet into that Projekt via ``commit_import``.

It is idempotent / re-runnable (local, staging, prod): the importer skips rows
whose capture key already exists, so a second run creates no duplicate captures,
and the Organisation / Projekt are get-or-created. It imports the committed,
de-identified ``demo_iwm.xlsx`` — the anonymiser's (#177) output over the
synthetic ``sample_iwm_illmitz.xlsx`` today, a pure file replacement once the
maintainer re-runs the anonymiser over the real export (ADR 0012).
"""

import os
from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from birds.iwm_import import IwmStructureError, commit_import
from birds.models import Mitgliedschaft, Organization, Project, Scientist

DEMO_ORG_HANDLE = "BDDEMO"
DEMO_ORG_NAME = "BirdDoc Demo"
DEMO_PROJECT_TITLE = "Referenzprojekt Neusiedlersee"

# The committed, de-identified demo sheet the Referenzprojekt is seeded from
# (ADR 0012): the anonymiser's (#177) output over the synthetic
# ``sample_iwm_illmitz.xlsx``. The maintainer overwrites it by re-running the
# anonymiser on the real export — a pure file replacement, no code change. The
# synthetic ``sample_iwm_illmitz.xlsx`` is retained as the import-feature test
# fixture and the anonymiser's test input.
DEMO_IMPORT_FILE = Path(__file__).resolve().parents[2] / "demo" / "demo_iwm.xlsx"

# The demo Admin (issue #178, ADR 0012). The importer resolves a Beringer by
# Kürzel across the org's Scientists, so pre-creating ``ABE`` means a later
# curated import attributes the Admin's captures to this named account instead of
# auto-creating a nameless duplicate. ``DEMO_ADMIN_KÜRZEL`` is the one value this
# seed shares with the anonymiser.
DEMO_ADMIN_KÜRZEL = "ABE"
DEMO_ADMIN_EMAIL = "demo@birddoc.eu"
# A rename-able placeholder identity — the operator may relabel it later.
DEMO_ADMIN_FIRST_NAME = "Anna"
DEMO_ADMIN_LAST_NAME = "Berger"
# Known dev password used only under DEBUG (overridable via DEMO_ADMIN_PASSWORD).
DEFAULT_DEMO_ADMIN_PASSWORD = "demo-birddoc"


class Command(BaseCommand):
    help = (
        "Seed the demo Referenzprojekt (Organisation BDDEMO) by importing an IWM "
        "Datenmeldung sheet through the shared import service. Idempotent and "
        "re-runnable."
    )

    def handle(self, *args, **options):
        content = self._read(DEMO_IMPORT_FILE)

        org, _ = Organization.objects.get_or_create(
            handle=DEMO_ORG_HANDLE,
            defaults={"name": DEMO_ORG_NAME, "country": "AT"},
        )
        # Create the Projekt with its context (Fangmethode/Lockmittel/Umstand)
        # UNSET so the importer adopts the file's homogeneous values (ADR 0002) —
        # the Referenzprojekt inherits its methodology from the demo sheet rather
        # than hard-coding it or keeping the model defaults.
        project, _ = Project.objects.get_or_create(
            title=DEMO_PROJECT_TITLE,
            organization=org,
            defaults={"capture_method": "", "lure": "", "circumstance": ""},
        )

        # Pre-create the named demo Admin (ABE) before importing, so the curated
        # import attributes its captures to this account (issue #178, ADR 0012).
        self._ensure_demo_admin(org)

        # ``enforce_cap=False``: this is the sanctioned over-cap path (ADR 0013).
        # The API rejects a file beyond ROW_CAP (issue #125); the command loads a
        # demo seed or a multi-year one-time backfill without a background worker.
        try:
            result = commit_import(content, project, enforce_cap=False)
        except IwmStructureError as exc:
            raise CommandError(str(exc)) from exc

        self._report(org, project, result)

    def _ensure_demo_admin(self, org):
        """Idempotently pre-create the demo Admin (login, Beringer, Mitgliedschaft).

        An ordinary Admin Mitglied in BDDEMO consuming one Mitgliedsplatz — no
        ``is_demo`` / schema marker (ADR 0012). The trio is get-or-created so a
        re-run makes no duplicates. The password is set **only on first creation**
        (never on re-run), so a prod secret set out-of-band survives: under DEBUG a
        known dev password (overridable via ``DEMO_ADMIN_PASSWORD``), otherwise an
        unusable password the operator sets out-of-band.
        """
        User = get_user_model()
        user, user_created = User.objects.get_or_create(
            username=DEMO_ADMIN_EMAIL,
            defaults={"email": DEMO_ADMIN_EMAIL, "is_active": True},
        )
        if user_created:
            if settings.DEBUG:
                password = os.environ.get("DEMO_ADMIN_PASSWORD") or DEFAULT_DEMO_ADMIN_PASSWORD
                user.set_password(password)
            else:
                # No known credential ships in a real deployment; the operator
                # sets the password out-of-band.
                user.set_unusable_password()
            user.save(update_fields=["password"])

        Scientist.objects.get_or_create(
            handle=DEMO_ADMIN_KÜRZEL,
            defaults={
                "first_name": DEMO_ADMIN_FIRST_NAME,
                "last_name": DEMO_ADMIN_LAST_NAME,
                "organization": org,
                "user": user,
            },
        )
        Mitgliedschaft.objects.get_or_create(
            user=user,
            organization=org,
            defaults={"rolle": Mitgliedschaft.Rolle.ADMIN},
        )

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
