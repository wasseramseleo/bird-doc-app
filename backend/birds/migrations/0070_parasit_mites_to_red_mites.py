# Parasit vocabulary (issue #406): the retired ``mites`` code becomes ``red_mites``.

from django.db import migrations

# The retirement, in both directions. Kept as literals rather than importing
# ``DataEntry.Parasit``: a migration must stay pinned to the vocabulary as it was
# at THIS point in history, or a later enum edit silently rewrites what this
# migration did.
_RETIRED = "mites"
_SUCCESSOR = "red_mites"


def _rewrite(apps, old, new):
    """Swap one parasite code for another across every capture, in place.

    Scans all rows rather than filtering on ``parasites__contains``: the JSON
    containment lookup is unsupported on sqlite, which is what dev and the whole
    test suite run on (ADR 0027) — only prod is Postgres. The list is short and
    the rewrite is a one-off, so the scan is cheap enough to be the portable
    choice. Codes other than ``old`` keep their value and their position."""
    DataEntry = apps.get_model("birds", "DataEntry")
    for entry in DataEntry.objects.all():
        parasites = entry.parasites or []
        if old not in parasites:
            continue
        entry.parasites = [new if code == old else code for code in parasites]
        entry.save(update_fields=["parasites"])


def mites_to_red_mites(apps, schema_editor):
    """Carry historical „Milben" captures onto the named vocabulary (issue #406).

    The user's ruling: the former catch-all „Milben" always meant *Dermanyssus
    gallinae* — Rote Milben. Every stored ``mites`` becomes ``red_mites``, in
    place, so a historical capture keeps its meaning under the new five-type
    vocabulary. Any other type on the same capture is left untouched and keeps
    its position; a capture with no Milben is not rewritten at all."""
    _rewrite(apps, _RETIRED, _SUCCESSOR)


def red_mites_to_mites(apps, schema_editor):
    """Reverse: fold Rote Milben back onto the retired „Milben" code, so a
    rollback to the previous release leaves every capture readable by the
    vocabulary that release knows."""
    _rewrite(apps, _SUCCESSOR, _RETIRED)


class Migration(migrations.Migration):
    dependencies = [
        ("birds", "0069_remove_dataentry_unique_erstfang_per_ring_and_more"),
    ]

    operations = [
        migrations.RunPython(mites_to_red_mites, red_mites_to_mites),
    ]
