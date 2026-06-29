from django.db import migrations


def backfill_ring_organization(apps, schema_editor):
    """Attribute every legacy Ring to an Organisation (ADR 0006, issue #75).

    Rings predating the tenant boundary carry no Organisation. A Ring is reached
    only through the captures that reference it, and each capture is itself
    org-owned (backfilled in 0045), so the capture is the reliable source: set
    each org-less Ring's Organisation to that of a capture referencing it.

    This assigns existing rows without data loss — no row is dropped and every
    capture keeps its Ring. An orphan Ring (no captures) is left org-less; the
    ring-cleanup path removes such rows anyway. The cutover transform performs the
    final partitioning of real data, so the two must not conflict — this only
    fills the gap, it never re-partitions a Ring that already carries an org.
    """
    Ring = apps.get_model("birds", "Ring")
    DataEntry = apps.get_model("birds", "DataEntry")
    for ring in Ring.objects.filter(organization__isnull=True):
        entry = DataEntry.objects.filter(ring=ring, organization__isnull=False).first()
        if entry is not None:
            ring.organization_id = entry.organization_id
            ring.save(update_fields=["organization"])


def noop_reverse(apps, schema_editor):
    # The field is dropped on reverse of the schema migration; nothing to undo.
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("birds", "0046_ring_organization"),
    ]

    operations = [
        migrations.RunPython(backfill_ring_organization, noop_reverse),
    ]
