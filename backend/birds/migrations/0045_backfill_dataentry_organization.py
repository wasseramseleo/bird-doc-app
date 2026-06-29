from django.db import migrations


def backfill_organization(apps, schema_editor):
    """Attribute every legacy capture to an Organisation (ADR 0005, issue #69).

    Captures predating the tenant boundary carry no Organisation. The Station is
    required and is itself org-owned, so it is the reliable source: set each
    capture's Organisation to that of its Station. (The model's ``save()`` does
    the same for new rows, but migrations bypass ``save()``.)
    """
    DataEntry = apps.get_model("birds", "DataEntry")
    for entry in DataEntry.objects.filter(organization__isnull=True).select_related(
        "ringing_station"
    ):
        entry.organization_id = entry.ringing_station.organization_id
        entry.save(update_fields=["organization"])


def noop_reverse(apps, schema_editor):
    # The field is dropped on reverse of the schema migration; nothing to undo.
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("birds", "0044_dataentry_organization"),
    ]

    operations = [
        migrations.RunPython(backfill_organization, noop_reverse),
    ]
