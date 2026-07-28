# Die Wochengrenze pro Projekt (ADR 0036, issue #431): Wochentag + Uhrzeit, beide
# NICHT nullbar mit Default (Montag 00:00). „Unkonfiguriert" ist damit kein eigener
# Zustand, sondern schlicht der Default — jedes bestehende Projekt landet auf
# Montag 00:00 und die „Diese Woche"-Voreinstellung bedeutet überall dasselbe.
# Bewusst anders als das nullbare Saison-Fenster, dessen Nicht-Konfiguration seinen
# Preset versteckt.

import datetime
import django.core.validators
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('birds', '0072_project_hidden_optional_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='project',
            name='wochengrenze_time',
            field=models.TimeField(default=datetime.time(0, 0), verbose_name='Wochengrenze (Uhrzeit)'),
        ),
        migrations.AddField(
            model_name='project',
            name='wochengrenze_weekday',
            field=models.PositiveSmallIntegerField(choices=[(0, 'Montag'), (1, 'Dienstag'), (2, 'Mittwoch'), (3, 'Donnerstag'), (4, 'Freitag'), (5, 'Samstag'), (6, 'Sonntag')], default=0, validators=[django.core.validators.MaxValueValidator(6)], verbose_name='Wochengrenze (Wochentag)'),
        ),
    ]
