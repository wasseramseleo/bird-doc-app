from django.db import migrations


def backfill_names_from_user(apps, schema_editor):
    """Copy each linked user's name into the Beringer's own name fields.

    Search and ordering now operate on the Beringer's own ``first_name`` /
    ``last_name``; existing account-linked Beringer have those empty, so we
    seed them from the user once. Beringer that already carry a name (or have
    no user) are left untouched.
    """
    Scientist = apps.get_model("birds", "Scientist")
    for scientist in Scientist.objects.filter(user__isnull=False):
        if not scientist.first_name and not scientist.last_name:
            scientist.first_name = scientist.user.first_name
            scientist.last_name = scientist.user.last_name
            scientist.save(update_fields=["first_name", "last_name"])


class Migration(migrations.Migration):
    dependencies = [
        ("birds", "0026_scientist_first_name_scientist_last_name_and_more"),
    ]

    operations = [
        migrations.RunPython(backfill_names_from_user, migrations.RunPython.noop),
    ]
