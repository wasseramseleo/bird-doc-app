# Optionale Felder (ADR 0035, issue #430): the two per-Projekt visibility booleans
# fold into ONE opt-out list of hidden field keys — a hard cut, so both columns go
# in the same migration the list arrives in.

from django.db import migrations, models

# The vocabulary as it stands at THIS point in history. Kept as literals rather
# than importing ``Project.OptionalField``: a later enum edit must not silently
# rewrite what this migration did.
_OPTIONAL_KEYS = [
    "brood_patch",
    "cpl_plus",
    "hunger_stripes",
    "parasit",
    "notch_f2",
    "inner_foot",
]
_NET_KEY = "net_block"


def booleans_to_opt_out_list(apps, schema_editor):
    """Carry each Projekt's current field visibility onto the opt-out list, so it
    shows after the update exactly what it showed before (ADR 0035).

    ``show_optional_fields=False`` ⇒ the six optional keys; ``show_net_fields=False``
    ⇒ the Netz key; both off ⇒ all seven; neither ⇒ an empty list. The list records
    what was switched *off*, so a Projekt that never touched either boolean lands on
    the empty default and keeps showing everything.
    """
    Project = apps.get_model("birds", "Project")
    for project in Project.objects.all():
        hidden = []
        if not project.show_optional_fields:
            hidden.extend(_OPTIONAL_KEYS)
        if not project.show_net_fields:
            hidden.append(_NET_KEY)
        project.hidden_optional_fields = hidden
        project.save(update_fields=["hidden_optional_fields"])


def opt_out_list_to_booleans(apps, schema_editor):
    """Reverse: fold the opt-out list back onto the two booleans, so a rollback to
    the previous release leaves every Projekt readable by the visibility model that
    release knows. A Projekt that hid *some* of the six optional keys has no
    all-or-nothing boolean to land on and reads as „Optionalblock an" — the coarser
    model simply cannot express the finer selection.
    """
    Project = apps.get_model("birds", "Project")
    for project in Project.objects.all():
        hidden = set(project.hidden_optional_fields or [])
        project.show_optional_fields = not all(key in hidden for key in _OPTIONAL_KEYS)
        project.show_net_fields = _NET_KEY not in hidden
        project.save(update_fields=["show_optional_fields", "show_net_fields"])


class Migration(migrations.Migration):
    dependencies = [
        ("birds", "0071_unmigratablepayload"),
    ]

    operations = [
        # Add the list first so the data migration can fold the booleans onto it
        # before the two columns are dropped.
        migrations.AddField(
            model_name="project",
            name="hidden_optional_fields",
            field=models.JSONField(
                blank=True, default=list, verbose_name="Ausgeblendete optionale Felder"
            ),
        ),
        migrations.RunPython(booleans_to_opt_out_list, opt_out_list_to_booleans),
        migrations.RemoveField(model_name="project", name="show_optional_fields"),
        migrations.RemoveField(model_name="project", name="show_net_fields"),
    ]
