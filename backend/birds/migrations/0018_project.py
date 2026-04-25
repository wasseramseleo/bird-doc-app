import uuid

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('birds', '0017_ringingstation_organization'),
    ]

    operations = [
        migrations.CreateModel(
            name='Project',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('title', models.CharField(max_length=255, verbose_name='Titel')),
                ('description', models.TextField(blank=True, verbose_name='Beschreibung')),
                ('created', models.DateTimeField(auto_now_add=True)),
                ('updated', models.DateTimeField(auto_now=True)),
                ('organization', models.ForeignKey(
                    on_delete=models.deletion.PROTECT,
                    related_name='projects',
                    to='birds.organization',
                    verbose_name='Organisation',
                )),
                ('scientists', models.ManyToManyField(
                    blank=True,
                    related_name='projects',
                    to='birds.scientist',
                    verbose_name='Beringer',
                )),
            ],
        ),
    ]
