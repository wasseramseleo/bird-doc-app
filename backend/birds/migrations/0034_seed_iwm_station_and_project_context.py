from decimal import Decimal

from django.db import migrations

# The single existing ringing site (Linz, Botanischer Garten) and the existing
# monitoring project predate the IWM geography / capture-context fields. Seed
# them so the IWM export fills the previously-empty columns immediately.
STATION_GEOGRAPHY = {
    "country": "Austria",
    "region": "Oberösterreich",
    "place_code": "AU03",
    "latitude": Decimal("48.295892"),
    "longitude": Decimal("14.276697"),
}
PROJECT_CAPTURE_CONTEXT = {
    "circumstance": "25",
    "capture_method": "M",
    "lure": "N",
}


def seed(apps, schema_editor):
    RingingStation = apps.get_model("birds", "RingingStation")
    Project = apps.get_model("birds", "Project")
    # Only stations without a country yet — leave any already-configured site alone.
    RingingStation.objects.filter(country="").update(**STATION_GEOGRAPHY)
    Project.objects.update(**PROJECT_CAPTURE_CONTEXT)


class Migration(migrations.Migration):
    dependencies = [
        ("birds", "0033_project_capture_method_project_circumstance_and_more"),
    ]

    operations = [
        migrations.RunPython(seed, migrations.RunPython.noop),
    ]
