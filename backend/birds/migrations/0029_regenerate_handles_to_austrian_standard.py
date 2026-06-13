from django.db import migrations

from birds.handle_regeneration import regenerate_handles


def regenerate_to_austrian_standard(apps, schema_editor):
    """Bring existing Beringer handles into line with the Austrian-standard Kürzel.

    Reuses the single derivation via ``regenerate_handles``. Handles that would
    collide are left untouched and printed for deliberate manual resolution.
    """
    Scientist = apps.get_model("birds", "Scientist")
    for collision in regenerate_handles(Scientist):
        left = ", ".join(sorted(b.handle for b in collision.beringer))
        print(
            f"Kürzel collision on '{collision.handle}': left unchanged for "
            f"Beringer [{left}] — resolve manually."
        )


class Migration(migrations.Migration):
    dependencies = [
        ("birds", "0028_alter_scientist_handle"),
    ]

    operations = [
        migrations.RunPython(regenerate_to_austrian_standard, migrations.RunPython.noop),
    ]
