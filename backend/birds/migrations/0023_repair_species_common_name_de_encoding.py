from django.db import migrations


MOJIBAKE_MARKERS = ('Ã', 'Â', 'Å')


def forwards_func(apps, schema_editor):
    """Repair UTF-8/Latin-1 mojibake in Species.common_name_de.

    The initial CSV import (migration 0003) opened a UTF-8 file with
    encoding='iso-8859-1', so umlauts were stored as e.g. 'Ã¤' instead
    of 'ä'. Reverse by re-encoding as Latin-1 and decoding as UTF-8.
    """
    Species = apps.get_model('birds', 'Species')
    db_alias = schema_editor.connection.alias

    candidates = Species.objects.using(db_alias)
    fixed = []
    scanned = 0

    for species in candidates.iterator():
        value = species.common_name_de
        if not value or not any(m in value for m in MOJIBAKE_MARKERS):
            continue
        scanned += 1
        try:
            repaired = value.encode('latin-1').decode('utf-8')
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue
        if repaired != value:
            species.common_name_de = repaired
            fixed.append(species)

    if fixed:
        Species.objects.using(db_alias).bulk_update(fixed, ['common_name_de'])

    print(f"\n[0023] Repaired {len(fixed)} of {scanned} mojibake-suspect species.")


class Migration(migrations.Migration):
    dependencies = [
        ('birds', '0022_seed_austrian_ring_sizes'),
    ]

    operations = [
        migrations.RunPython(forwards_func, migrations.RunPython.noop),
    ]
