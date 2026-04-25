from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('birds', '0018_project'),
    ]

    operations = [
        migrations.AddField(
            model_name='dataentry',
            name='project',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=models.deletion.PROTECT,
                related_name='data_entries',
                to='birds.project',
                verbose_name='Projekt',
            ),
        ),
        migrations.AlterField(
            model_name='dataentry',
            name='ringing_station',
            field=models.ForeignKey(
                on_delete=models.deletion.PROTECT,
                to='birds.ringingstation',
                verbose_name='Station',
            ),
        ),
    ]
