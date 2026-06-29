from django.db import migrations

FALLBACK_HANDLE = "GELÖSCHT"


def create_fallback(apps, schema_editor):
    """Create the single reserved fallback Beringer ('Gelöschter Nutzer').

    Deleting a Beringer reassigns their captures to this row (DataEntry.staff is
    on_delete=SET(get_fallback_beringer)) so no capture data is ever lost. It is
    hidden from the Beringer autocomplete (ScientistViewSet excludes the Kürzel)
    so no fresh capture can be filed against it. Scope: exactly this one row.
    Mirrors the 'Ring Vernichtet' sentinel migration (0032).
    """
    Scientist = apps.get_model("birds", "Scientist")
    Scientist.objects.update_or_create(
        handle=FALLBACK_HANDLE,
        defaults={"first_name": "Gelöschter", "last_name": "Nutzer"},
    )


def remove_fallback(apps, schema_editor):
    Scientist = apps.get_model("birds", "Scientist")
    Scientist.objects.filter(handle=FALLBACK_HANDLE).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("birds", "0035_alter_dataentry_staff"),
    ]

    operations = [
        migrations.RunPython(create_fallback, remove_fallback),
    ]
