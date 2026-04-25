import csv
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import IntegrityError

from birds.models import Species

OTHER_SPECIES = {
    "common_name_de": "Andere Art",
    "common_name_en": "Other Species",
    "family_name": "",
    "order_name": "",
    "ring_size": None,
}


class Command(BaseCommand):
    help = "Import bird species from a semicolon-delimited CSV file."

    def add_arguments(self, parser):
        parser.add_argument("filepath", type=str, help="Path to the CSV file")
        parser.add_argument(
            "--clear",
            action="store_true",
            help="Delete all existing species before importing",
        )
        parser.add_argument(
            "--no-other",
            action="store_true",
            help='Skip creating the "Andere Art" catch-all entry',
        )

    def handle(self, *args, **options):
        path = Path(options["filepath"])
        if not path.exists():
            raise CommandError(f"File not found: {path}")

        if options["clear"]:
            deleted, _ = Species.objects.all().delete()
            self.stdout.write(f"Cleared {deleted} existing species.")

        created = updated = skipped = 0

        with path.open(encoding="utf-8") as f:
            reader = csv.DictReader(f, delimiter=";")
            for row in reader:
                scientific_name = row.get("scientific_name", "").strip()
                common_name_de = row.get("common_name_de", "").strip()
                common_name_en = row.get("common_name_en", "").strip()
                order_name = row.get("order_name", "").strip()
                family_name = row.get("family_name", "").strip()

                if not scientific_name or not common_name_de:
                    skipped += 1
                    continue

                try:
                    _, was_created = Species.objects.update_or_create(
                        scientific_name=scientific_name,
                        defaults={
                            "common_name_de": common_name_de,
                            "common_name_en": common_name_en,
                            "order_name": order_name,
                            "family_name": family_name,
                        },
                    )
                    if was_created:
                        created += 1
                    else:
                        updated += 1
                except IntegrityError as e:
                    self.stderr.write(f"Skipped row (integrity error) — {scientific_name!r}: {e}")
                    skipped += 1

        self.stdout.write(
            f"Import complete: {created} created, {updated} updated, {skipped} skipped."
        )

        if not options["no_other"]:
            _, was_created = Species.objects.update_or_create(
                scientific_name="other",
                defaults=OTHER_SPECIES,
            )
            action = "Created" if was_created else "Ensured"
            self.stdout.write(f'{action} "Andere Art" catch-all entry.')
