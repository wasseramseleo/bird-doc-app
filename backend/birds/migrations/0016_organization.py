import uuid

from django.db import migrations, models


def seed_vogelwarte(apps, schema_editor):
    Organization = apps.get_model('birds', 'Organization')
    Organization.objects.update_or_create(
        handle='AUW',
        defaults={'name': 'Vogelwarte Österreich', 'country': 'AT'},
    )


def unseed_vogelwarte(apps, schema_editor):
    Organization = apps.get_model('birds', 'Organization')
    Organization.objects.filter(handle='AUW').delete()


class Migration(migrations.Migration):

    dependencies = [
        ('birds', '0015_specieslist'),
    ]

    operations = [
        migrations.CreateModel(
            name='Organization',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, unique=True)),
                ('name', models.CharField(max_length=255, verbose_name='Name')),
                ('handle', models.CharField(max_length=64, primary_key=True, serialize=False, unique=True, verbose_name='Kürzel')),
                ('country', models.CharField(blank=True, max_length=8, verbose_name='Land')),
            ],
        ),
        migrations.RunPython(seed_vogelwarte, unseed_vogelwarte),
    ]
