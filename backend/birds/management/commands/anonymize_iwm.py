"""Anonymise a real IWM ``Datenmeldung`` export into a safe ``demo_iwm.xlsx``
(issue #177, ADR 0012).

A thin CLI wrapper around ``birds.iwm_anonymize.anonymize_workbook`` — it only
loads the input workbook, runs the deterministic transform, and saves the result.
The maintainer runs it locally over the real export (which never enters the repo)
and commits only the de-identified output::

    manage.py anonymize_iwm --input real.xlsx --output demo_iwm.xlsx

Because the transform reads the authentic ``Fangdaten`` format, the very same
command runs unchanged over the committed ``sample_iwm_illmitz.xlsx`` today.
"""

from pathlib import Path

import openpyxl
from django.core.management.base import BaseCommand, CommandError

from birds.iwm_anonymize import AnonymizeStructureError, anonymize_workbook


class Command(BaseCommand):
    help = (
        "De-identify a real IWM Datenmeldung export into a safe demo_iwm.xlsx via "
        "the deterministic anonymiser (same output on the same input)."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--input", required=True, type=Path, help="Path to the real IWM .xlsx export."
        )
        parser.add_argument(
            "--output", required=True, type=Path, help="Path to write the anonymised .xlsx."
        )

    def handle(self, *args, **options):
        source = options["input"]
        target = options["output"]
        try:
            workbook = openpyxl.load_workbook(source)
        except OSError as exc:
            raise CommandError(f"Konnte die Eingabedatei nicht lesen: {source} ({exc})") from exc
        except Exception as exc:  # openpyxl raises a grab-bag on non-workbook input
            raise CommandError(
                f"Die Datei konnte nicht als Excel-Arbeitsmappe gelesen werden: {source}"
            ) from exc

        try:
            anonymize_workbook(workbook)
        except AnonymizeStructureError as exc:
            raise CommandError(str(exc)) from exc

        target.parent.mkdir(parents=True, exist_ok=True)
        workbook.save(target)
        self.stdout.write(self.style.SUCCESS(f"Anonymisierte Datenmeldung geschrieben: {target}"))
