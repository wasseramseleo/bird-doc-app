from django.db import migrations


def set_ring_destroyed(apps, schema_editor):
    """Re-key the existing destroyed-ring sentinel onto the special_kind
    discriminator. The conflated is_sentinel boolean is being retired; the one
    is_sentinel=True row (the 'Ring Vernichtet' marker from migration 0032)
    becomes special_kind='ring_destroyed', preserving its behaviour."""
    Species = apps.get_model("birds", "Species")
    Species.objects.filter(is_sentinel=True).update(special_kind="ring_destroyed")


def clear_ring_destroyed(apps, schema_editor):
    Species = apps.get_model("birds", "Species")
    Species.objects.filter(special_kind="ring_destroyed").update(
        is_sentinel=True, special_kind=""
    )


class Migration(migrations.Migration):
    dependencies = [
        ("birds", "0035_species_special_kind"),
    ]

    operations = [
        migrations.RunPython(set_ring_destroyed, clear_ring_destroyed),
    ]
