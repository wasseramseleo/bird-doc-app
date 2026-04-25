from django.db import migrations, models


def assign_default_organization(apps, schema_editor):
    RingingStation = apps.get_model('birds', 'RingingStation')
    Organization = apps.get_model('birds', 'Organization')
    default_org = Organization.objects.get(handle='AUW')
    RingingStation.objects.filter(organization__isnull=True).update(organization=default_org)


def clear_organization(apps, schema_editor):
    RingingStation = apps.get_model('birds', 'RingingStation')
    RingingStation.objects.update(organization=None)


class Migration(migrations.Migration):

    dependencies = [
        ('birds', '0016_organization'),
    ]

    operations = [
        migrations.AddField(
            model_name='ringingstation',
            name='organization',
            field=models.ForeignKey(
                null=True,
                on_delete=models.deletion.PROTECT,
                related_name='ringing_stations',
                to='birds.organization',
                verbose_name='Organisation',
            ),
        ),
        migrations.RunPython(assign_default_organization, clear_organization),
        migrations.AlterField(
            model_name='ringingstation',
            name='organization',
            field=models.ForeignKey(
                on_delete=models.deletion.PROTECT,
                related_name='ringing_stations',
                to='birds.organization',
                verbose_name='Organisation',
            ),
        ),
    ]
