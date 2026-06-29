from django.db import migrations

AVES_IGNOTA_DE = "Art nicht in der Liste (Aves ignota)"


def create_aves_ignota(apps, schema_editor):
    """Create the single 'Aves ignota' Sonderart row.

    A catch of an Art that is not on the active Artenliste is still a real
    captured bird, so unlike the 'Ring Vernichtet' marker it keeps the full
    measurement form; the mandatory Bemerkung (enforced in the serializer)
    ensures the unusual catch is always described. The unique/NOT-NULL name
    fields get the agreed placeholders; the recommended ring size stays empty.
    Scope: exactly this one row. Follows migration 0032's pattern.
    """
    Species = apps.get_model("birds", "Species")
    Species.objects.update_or_create(
        common_name_de=AVES_IGNOTA_DE,
        defaults={
            "common_name_en": "Species not listed",
            "scientific_name": "Aves ignota",
            "family_name": "—",
            "order_name": "—",
            "ring_size": None,
            "special_kind": "unknown_species",
        },
    )


def remove_aves_ignota(apps, schema_editor):
    Species = apps.get_model("birds", "Species")
    Species.objects.filter(
        common_name_de=AVES_IGNOTA_DE, special_kind="unknown_species"
    ).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("birds", "0036_convert_sentinel_to_ring_destroyed"),
    ]

    operations = [
        migrations.RunPython(create_aves_ignota, remove_aves_ignota),
    ]
