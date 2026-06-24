from django.db import migrations

SENTINEL_DE = "Ring Vernichtet"


def create_sentinel(apps, schema_editor):
    """Create the single 'Ring Vernichtet' sentinel species.

    A destroyed ring is recorded as a normal DataEntry whose species points at
    this sentinel. The unique/NOT-NULL name fields get plain placeholders; the
    recommended ring size stays empty. Scope: exactly this one sentinel.
    """
    Species = apps.get_model("birds", "Species")
    Species.objects.update_or_create(
        common_name_de=SENTINEL_DE,
        defaults={
            "common_name_en": "Ring Destroyed",
            "scientific_name": "Anulus deletus",
            "family_name": "—",
            "order_name": "—",
            "ring_size": None,
            "is_sentinel": True,
        },
    )


def remove_sentinel(apps, schema_editor):
    Species = apps.get_model("birds", "Species")
    Species.objects.filter(common_name_de=SENTINEL_DE, is_sentinel=True).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("birds", "0031_species_is_sentinel_alter_dataentry_age_class_and_more"),
    ]

    operations = [
        migrations.RunPython(create_sentinel, remove_sentinel),
    ]
