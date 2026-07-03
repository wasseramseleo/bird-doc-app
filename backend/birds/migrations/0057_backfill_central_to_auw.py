"""Backfill every existing Ring and Projekt to the AUW Zentrale (ADR 0019).

Rings and Projekte predate the ``central`` field, so they carry no Zentrale. At
cutover all real data is attributed to the Austrian Vogelwarte (EURING scheme
``AUW``, seeded in 0056): this data migration sets ``central`` to AUW on every
Ring and every Projekt across **all** tenants — including the demo tenant /
Referenzprojekt — that predate the field.

This assigns existing rows without data loss: no row is dropped, and only rows
that still carry no Zentrale are touched, so a re-run is a no-op. New Ringe and
Projekte resolve their Zentrale to AUW in ``save()`` / the capture write path.
"""

from django.db import migrations

AUW_SCHEME_CODE = "AUW"


def backfill_central_to_auw(apps, schema_editor):
    Central = apps.get_model("birds", "Central")
    Ring = apps.get_model("birds", "Ring")
    Project = apps.get_model("birds", "Project")

    auw = Central.objects.get(scheme_code=AUW_SCHEME_CODE)
    Ring.objects.filter(central__isnull=True).update(central=auw)
    Project.objects.filter(central__isnull=True).update(central=auw)


def noop_reverse(apps, schema_editor):
    # The field is dropped on reverse of the schema migration; nothing to undo.
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("birds", "0056_seed_euring_centrals"),
    ]

    operations = [
        migrations.RunPython(backfill_central_to_auw, noop_reverse),
    ]
