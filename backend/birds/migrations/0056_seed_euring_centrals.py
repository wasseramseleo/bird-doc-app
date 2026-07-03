"""Seed the published EURING ringing-scheme list as ``Central`` rows (ADR 0019).

A ``Central`` (Zentrale) is global reference data like ``Species`` — never
tenant-scoped. This one-shot data migration seeds the comprehensive published
EURING scheme register: the ``(scheme_code, name, country)`` of every current
EURING ringing centre plus the well-known historical and non-European schemes.
The list is sourced from the published EURING register at implementation time
(the EURING Data Bank data-holdings register and the EURING/ELSA scheme tables).

The home scheme ``AUW`` (the Austrian Vogelwarte) is always present — it is the
default every existing Ring and Projekt is backfilled to (migration 0057) and
the default for every new Projekt. The Slovak Bratislava scheme ``SKB`` (used by
later slices for the Slovak 'S' ring) is likewise present.

Seeding is idempotent (``update_or_create`` keyed on the unique ``scheme_code``)
so a re-run refreshes names/countries without minting duplicates.
"""

from django.db import migrations

# (scheme_code, name, country). AUW carries its proper centre name per ADR 0019;
# the rest carry the ringing centre / city and the country as published.
EURING_CENTRALS = [
    ("AUW", "Österreichische Vogelwarte", "Austria"),
    ("ABT", "Tirana", "Albania"),
    ("AML", "Lusarat Bird Station", "Armenia"),
    ("BGS", "Sofia", "Bulgaria"),
    ("BHS", "Sarajevo", "Bosnia and Herzegovina"),
    ("BLB", "Bruxelles", "Belgium"),
    ("BYM", "Minsk", "Belarus"),
    ("CIJ", "Jersey", "Channel Islands"),
    ("CYC", "Nicosia", "Cyprus"),
    ("CYK", "Kuskor", "Cyprus"),
    ("CZP", "Praha", "Czech Republic"),
    ("DEH", "Hiddensee", "Germany"),
    ("DER", "Radolfzell", "Germany"),
    ("DEW", "Wilhelmshaven (Helgoland)", "Germany"),
    ("DKC", "Copenhagen", "Denmark"),
    ("DKX", "Mortensen (private)", "Denmark"),
    ("ESA", "San Sebastian (Aranzadi)", "Spain"),
    ("ESC", "Barcelona (Catalonia)", "Spain"),
    ("ESS", "Madrid (SEO)", "Spain"),
    ("ETM", "Matsalu", "Estonia"),
    ("FRP", "Paris", "France"),
    ("GBT", "United Kingdom and Ireland (BTO)", "United Kingdom"),
    ("GBX", "Crampton (private)", "United Kingdom"),
    ("GRA", "Athens", "Greece"),
    ("HES", "Sempach", "Switzerland"),
    ("HGB", "Budapest", "Hungary"),
    ("HRZ", "Zagreb", "Croatia"),
    ("IAB", "Bologna", "Italy"),
    ("ILT", "Tel Aviv", "Israel"),
    ("IPT", "Tehran", "Iran"),
    ("ISR", "Reykjavik", "Iceland"),
    ("JPY", "Yamashina Institute (Abiko)", "Japan"),
    ("KWR", "Cheongwon (KIWR)", "Korea"),
    ("KZA", "Almaty", "Kazakhstan"),
    ("LIK", "Kaunas", "Lithuania"),
    ("LVR", "Riga", "Latvia"),
    ("MAR", "Rabat", "Morocco"),
    ("MEP", "Podgorica", "Montenegro"),
    ("MKS", "Skopje", "North Macedonia"),
    ("MLV", "Valletta", "Malta"),
    ("NAW", "Washington", "North America"),
    ("NLA", "Arnhem", "Netherlands"),
    ("NOS", "Stavanger", "Norway"),
    ("PLG", "Gdansk", "Poland"),
    ("POL", "Lisboa", "Portugal"),
    ("ROB", "Bucharest", "Romania"),
    ("RSB", "Belgrade", "Serbia"),
    ("RUM", "Moscow", "Russian Federation"),
    ("SFH", "Helsinki", "Finland"),
    ("SKB", "Bratislava", "Slovakia"),
    ("SLL", "Ljubljana", "Slovenia"),
    ("SVS", "Stockholm", "Sweden"),
    ("TOT", "Tunis", "Tunisia"),
    ("TUA", "Ankara", "Turkey"),
    ("UKK", "Kiev", "Ukraine"),
    ("ZAC", "SAFRING (Cape Town)", "South Africa"),
]


def seed_centrals(apps, schema_editor):
    Central = apps.get_model("birds", "Central")
    for scheme_code, name, country in EURING_CENTRALS:
        Central.objects.update_or_create(
            scheme_code=scheme_code,
            defaults={"name": name, "country": country},
        )


def unseed_centrals(apps, schema_editor):
    Central = apps.get_model("birds", "Central")
    Central.objects.filter(
        scheme_code__in=[code for code, _name, _country in EURING_CENTRALS]
    ).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("birds", "0055_central_ring_and_project_zentrale"),
    ]

    operations = [
        migrations.RunPython(seed_centrals, unseed_centrals),
    ]
