import csv
import os
from django.db import migrations


def forwards_func(apps, schema_editor):
    """
    Reads bird species data from a CSV file and populates the Species model.
    """
    Species = apps.get_model('birds', 'Species')
    db_alias = schema_editor.connection.alias

    # Get the directory of the current migration file
    migration_dir = os.path.dirname(os.path.abspath(__file__))
    # Construct the full path to the CSV file
    csv_file_path = os.path.join(migration_dir, 'artenliste_2024.csv')

    species_to_create = []
    try:
        with open(csv_file_path, 'r', encoding='utf-8') as file:
            reader = csv.DictReader(file, delimiter=';')
            for row in reader:
                if not row['scientific_name'] or not row['common_name_en'] or not row['common_name_de']:
                    continue

                species_to_create.append(
                    Species(
                        order_name=row['order_name'],
                        family_name=row['family_name'],
                        scientific_name=row['scientific_name'],
                        common_name_en=row['common_name_en'],
                        common_name_de=row['common_name_de']
                    )
                )
    except FileNotFoundError:
        print(f"\n[Warning] CSV file not found at {csv_file_path}. Skipping data import.")
        return  # Exit if the file doesn't exist

    # Use bulk_create for efficient insertion of multiple objects
    if species_to_create:
        Species.objects.using(db_alias).bulk_create(species_to_create)


def reverse_func(apps, schema_editor):
    """
    Deletes all data from the Species model, reversing the migration.
    """
    Species = apps.get_model('birds', 'Species')
    db_alias = schema_editor.connection.alias
    Species.objects.using(db_alias).all().delete()


class Migration(migrations.Migration):
    dependencies = [
        ('birds', '0002_alter_dataentry_hand_wing_and_more'),
    ]

    operations = [
        migrations.RunPython(forwards_func, reverse_func),
    ]
