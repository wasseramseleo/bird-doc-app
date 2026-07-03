"""Seed the 11 globale Standard-Artennormen (PRD #245, issue #250, ADR 0021).

Every Organisation gets working Plausibilitätsprüfungen on day one off the
shipped defaults — no setup required — because these rows are written with
``organization = NULL`` (the globale Standard-Artennorm layer; a tenant may still
add its own override row later).

Following the ``0022_seed_austrian_ring_sizes.py`` pattern, the Ø/SD values are a
**static dict literal embedded in this migration**, extracted at build time from
the finalized ``docs/Korrekturebenen.xlsx`` (never read at runtime), keyed by
``scientific_name``. Match key is ``scientific_name``; all 11 are present in the
Species seed (0 unmatched expected). ``Kerbe F2`` and ``Innenfuß`` ship null (no
data yet), as does ``dj_grossgefiedermauser_moeglich`` (no column in the sheet).
The sheet's ±SD factor is 1.96 and its Quotient tolerance is 3 % on every row.
"""

from decimal import Decimal

from django.db import migrations


def _d(value):
    return None if value is None else Decimal(value)


# scientific_name -> Ø/SD values, hard-coded from docs/Korrekturebenen.xlsx.
# Columns in the sheet: Gewicht / Federlänge / Flügellänge Mittelwert + Std.-Abw.,
# Quotient Teilfederl./Flügell. (+/- % = Toleranz), Tarsus Mittelwert + SD, and
# "Geschlechtsbestimmung möglich" (ja/nein). Std.-Abw. is the SD; the sheet's
# separate "SD" column is the ±factor 1.96 (stored once as SD_FACTOR).
SD_FACTOR = Decimal("1.96")
QUOTIENT_TOLERANCE_PCT = Decimal("3")

SPECIES_NORMS = {
    # Teichrohrsänger (acrsci)
    "Acrocephalus scirpaceus": {
        "geschlechtsbestimmung_moeglich": False,
        "weight_mean": "11.3992", "weight_sd": "1.748",
        "feather_mean": "50.8685", "feather_sd": "1.9598",
        "wing_mean": "66.967", "wing_sd": "8.2932",
        "quotient_mean": "0.7634",
        "tarsus_mean": "22.53005", "tarsus_sd": "0.8196405",
    },
    # Bartmeise (panbia)
    "Panurus biarmicus": {
        "geschlechtsbestimmung_moeglich": True,
        "weight_mean": "14.1953", "weight_sd": "1.3415",
        "feather_mean": "44.6877", "feather_sd": "3.2212",
        "wing_mean": "59.7045", "wing_sd": "3.2565",
        "quotient_mean": "0.7493",
        "tarsus_mean": None, "tarsus_sd": None,
    },
    # Drosselrohrsänger (acraru)
    "Acrocephalus arundinaceus": {
        "geschlechtsbestimmung_moeglich": False,
        "weight_mean": "29.1694", "weight_sd": "2.9023",
        "feather_mean": "72.5733", "feather_sd": "4.6751",
        "wing_mean": "96.1116", "wing_sd": "3.657",
        "quotient_mean": "0.756",
        "tarsus_mean": "28.29897", "tarsus_sd": "1.438999",
    },
    # Haussperling (pasdom)
    "Passer domesticus": {
        "geschlechtsbestimmung_moeglich": True,
        "weight_mean": "27.12", "weight_sd": "2.681",
        "feather_mean": "59.025", "feather_sd": "1.3179",
        "wing_mean": "78.75", "wing_sd": "1.8941",
        "quotient_mean": "0.7496",
        "tarsus_mean": None, "tarsus_sd": None,
    },
    # Mariskensänger (acrmel) — DB common_name_de: Mariskenrohrsänger
    "Acrocephalus melanopogon": {
        "geschlechtsbestimmung_moeglich": False,
        "weight_mean": "11.1253", "weight_sd": "4.8047",
        "feather_mean": "43.6317", "feather_sd": "2.3678",
        "wing_mean": "58.4505", "wing_sd": "2.6168",
        "quotient_mean": "0.7468",
        "tarsus_mean": None, "tarsus_sd": None,
    },
    # Mönchsgrasmücke (sylatr)
    "Sylvia atricapilla": {
        "geschlechtsbestimmung_moeglich": True,
        "weight_mean": "18.5266", "weight_sd": "4.8447",
        "feather_mean": "56.7161", "feather_sd": "2.3667",
        "wing_mean": "75.3775", "wing_sd": "19.2607",
        "quotient_mean": "0.7594",
        "tarsus_mean": "20.39353", "tarsus_sd": "0.6880621",
    },
    # Nachtigall (lusmeg)
    "Luscinia megarhynchos": {
        "geschlechtsbestimmung_moeglich": False,
        "weight_mean": "22.9423", "weight_sd": "2.9258",
        "feather_mean": "65.3403", "feather_sd": "2.6416",
        "wing_mean": "85.8621", "wing_sd": "3.2467",
        "quotient_mean": "0.7596",
        "tarsus_mean": "26.79266", "tarsus_sd": "1.466376",
    },
    # Rohrschwirl (loclus)
    "Locustella luscinioides": {
        "geschlechtsbestimmung_moeglich": False,
        "weight_mean": "14.8559", "weight_sd": "1.218",
        "feather_mean": "51.1112", "feather_sd": "1.5002",
        "wing_mean": "69.9146", "wing_sd": "2.007",
        "quotient_mean": "0.7312",
        "tarsus_mean": "20.93316", "tarsus_sd": "0.685519",
    },
    # Schilfrohrsänger (acrsch)
    "Acrocephalus schoenobaenus": {
        "geschlechtsbestimmung_moeglich": False,
        "weight_mean": "11.3417", "weight_sd": "2.1286",
        "feather_mean": "50.9288", "feather_sd": "1.7558",
        "wing_mean": "67.1961", "wing_sd": "2.1924",
        "quotient_mean": "0.7589",
        "tarsus_mean": "20.99587", "tarsus_sd": "0.7325847",
    },
    # Singdrossel (turphi)
    "Turdus philomelos": {
        "geschlechtsbestimmung_moeglich": False,
        "weight_mean": "66.9785", "weight_sd": "5.3702",
        "feather_mean": "88.9346", "feather_sd": "3.3646",
        "wing_mean": "117.7674", "wing_sd": "2.7836",
        "quotient_mean": "0.7554",
        "tarsus_mean": "31.91007", "tarsus_sd": "2.823129",
    },
    # Neuntöter (lancol)
    "Lanius collurio": {
        "geschlechtsbestimmung_moeglich": True,
        "weight_mean": "27.5918", "weight_sd": "2.2865",
        "feather_mean": "70.9296", "feather_sd": "2.3494",
        "wing_mean": "93.7133", "wing_sd": "2.384",
        "quotient_mean": "0.757",
        "tarsus_mean": "22.91996", "tarsus_sd": "0.817737",
    },
}


def forwards_func(apps, schema_editor):
    Species = apps.get_model("birds", "Species")
    SpeciesNorm = apps.get_model("birds", "SpeciesNorm")

    matched = 0
    unmatched = []
    for scientific_name, values in SPECIES_NORMS.items():
        species = Species.objects.filter(scientific_name=scientific_name).first()
        if species is None:
            unmatched.append(scientific_name)
            continue
        SpeciesNorm.objects.update_or_create(
            species=species,
            organization=None,  # the globale Standard-Artennorm layer
            defaults={
                "weight_mean": _d(values["weight_mean"]),
                "weight_sd": _d(values["weight_sd"]),
                "feather_mean": _d(values["feather_mean"]),
                "feather_sd": _d(values["feather_sd"]),
                "wing_mean": _d(values["wing_mean"]),
                "wing_sd": _d(values["wing_sd"]),
                "tarsus_mean": _d(values["tarsus_mean"]),
                "tarsus_sd": _d(values["tarsus_sd"]),
                # Kerbe F2 + Innenfuß: no data yet → null.
                "notch_f2_mean": None,
                "notch_f2_sd": None,
                "inner_foot_mean": None,
                "inner_foot_sd": None,
                "quotient_mean": _d(values["quotient_mean"]),
                "quotient_tolerance_pct": QUOTIENT_TOLERANCE_PCT,
                "sd_factor": SD_FACTOR,
                "geschlechtsbestimmung_moeglich": values["geschlechtsbestimmung_moeglich"],
                # No dj.-Großgefiedermauser column in the sheet → null.
                "dj_grossgefiedermauser_moeglich": None,
            },
        )
        matched += 1

    print(
        f"\n  Standard-Artennorm seed: matched {matched}/{len(SPECIES_NORMS)} species"
        f" ({len(unmatched)} unmatched)"
    )
    if unmatched:
        print(f"  Unmatched scientific_names: {unmatched}")


def reverse_func(apps, schema_editor):
    Species = apps.get_model("birds", "Species")
    SpeciesNorm = apps.get_model("birds", "SpeciesNorm")
    species_ids = Species.objects.filter(
        scientific_name__in=SPECIES_NORMS.keys()
    ).values_list("id", flat=True)
    SpeciesNorm.objects.filter(
        organization__isnull=True, species_id__in=list(species_ids)
    ).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("birds", "0059_speciesnorm"),
    ]

    operations = [
        migrations.RunPython(forwards_func, reverse_func),
    ]
