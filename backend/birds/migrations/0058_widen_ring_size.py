"""Widen ``Ring.size`` from 3 to 10 chars for the Zentrale write path (ADR 0019).

An AUW ring keeps a short Austrian scheme code, but a foreign Zentrale records a
free-text Größe (trimmed, uppercased, length-capped) that no longer fits the old
three-character column. The single ``size`` column carries both — no second
column is added. ``choices`` stays on the field for the Austrian admin dropdown;
it never restricts a stored free-text value, since ``Ring.save()`` runs no
``full_clean``.
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("birds", "0057_backfill_central_to_auw"),
    ]

    operations = [
        migrations.AlterField(
            model_name="ring",
            name="size",
            field=models.CharField(
                choices=[
                    ("AS", "AS"),
                    ("BS", "BS"),
                    ("C", "C"),
                    ("D", "D"),
                    ("DS", "DS"),
                    ("DA", "DA"),
                    ("F", "F"),
                    ("FA", "FA"),
                    ("G", "G"),
                    ("GA", "GA"),
                    ("H", "H"),
                    ("HA", "HA"),
                    ("K", "K"),
                    ("KA", "KA"),
                    ("L", "L"),
                    ("LA", "LA"),
                    ("M", "M"),
                    ("N", "N"),
                    ("NA", "NA"),
                    ("P", "P"),
                    ("PA", "PA"),
                    ("R", "R"),
                    ("S", "S"),
                    ("SA", "SA"),
                    ("T", "T"),
                    ("TA", "TA"),
                    ("V", "V"),
                    ("X", "X"),
                ],
                default="V",
                max_length=10,
                verbose_name="Ringgröße",
            ),
        ),
    ]
