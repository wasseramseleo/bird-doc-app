"""
Patch ring sizes for species whose scientific_name uses modern (post-PDF) taxonomy.

Migration 0022 seeds Species.ring_size from the AOC PDF (Nov 2016), which still
uses pre-2010 names like Parus caeruleus and Carduelis chloris. The species table
itself is loaded from artenliste_2024.csv (modern IOC taxonomy), so those rows
never matched and ended up with ring_size = NULL.

This migration assigns the same ring sizes from 0022 to the modern names.
"""

from django.db import migrations


# modern scientific_name -> ring size (copied from PDF_RING_SIZES in 0022).
MODERN_TAXONOMY_RING_SIZES = {
    # Parus split (Paridae)
    "Cyanistes caeruleus": "V",   # Blaumeise (was Parus caeruleus)
    "Periparus ater": "V",        # Tannenmeise (was Parus ater)
    "Poecile palustris": "V",     # Sumpfmeise (was Parus palustris)
    "Poecile montanus": "V",      # Weidenmeise (was Parus montanus)
    "Lophophanes cristatus": "V", # Haubenmeise (was Parus cristatus)
    # Carduelis split (Fringillidae)
    "Chloris chloris": "T",       # Grünfink (was Carduelis chloris)
    "Spinus spinus": "V",         # Erlenzeisig (was Carduelis spinus)
    "Linaria cannabina": "V",     # Bluthänfling (was Carduelis cannabina)
    "Acanthis flammea": "V",      # Birkenzeisig (was Carduelis flammea)
    # Saxicola torquata split
    "Saxicola rubicola": "V",     # Schwarzkehlchen (was Saxicola torquata)
    # Miliaria → Emberiza
    "Emberiza calandra": "S",     # Grauammer (was Miliaria calandra)
}


def forwards_func(apps, schema_editor):
    Species = apps.get_model("birds", "Species")
    matched = 0
    unmatched = []
    for scientific_name, ring_size in MODERN_TAXONOMY_RING_SIZES.items():
        updated = Species.objects.filter(scientific_name=scientific_name).update(
            ring_size=ring_size
        )
        if updated:
            matched += updated
        else:
            unmatched.append(scientific_name)
    print(
        f"\n  Modern-taxonomy ring-size patch: matched {matched}/{len(MODERN_TAXONOMY_RING_SIZES)} species"
        f" ({len(unmatched)} unmatched)"
    )
    if unmatched:
        print(f"  Unmatched scientific_names: {unmatched}")


def reverse_func(apps, schema_editor):
    Species = apps.get_model("birds", "Species")
    Species.objects.filter(scientific_name__in=MODERN_TAXONOMY_RING_SIZES.keys()).update(ring_size=None)


class Migration(migrations.Migration):
    dependencies = [
        ("birds", "0024_project_show_optional_fields"),
    ]

    operations = [
        migrations.RunPython(forwards_func, reverse_func),
    ]
