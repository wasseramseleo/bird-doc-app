"""Data-assertion tests for the globale Standard-Artennormen seeds.

Migration ``0060_seed_species_norms`` (issue #250) seeds the original **11**
species; ``0061_seed_species_norms`` (issue #262) additively seeds the **58
net-new** species. Both embed a static dict literal (Ø/SD values extracted at
build time from ``docs/Korrekturebenen.xlsx``) and write one ``organization =
NULL`` ``SpeciesNorm`` row per seed species, matched by ``scientific_name``.
These tests assert the migrations' *effect on the database* after migrations run
— external behaviour, not the migrations' internals — mirroring the prior art
``test_seed_demo_org.py``.
"""

import pytest

from birds.models import SpeciesNorm

# The 11 seed species keyed by scientific_name (the migration's match key). The
# German ``Artname D`` is kept for the reviewer's benefit.
SEED_SCIENTIFIC_NAMES = {
    "Acrocephalus scirpaceus",  # Teichrohrsänger
    "Panurus biarmicus",  # Bartmeise
    "Acrocephalus arundinaceus",  # Drosselrohrsänger
    "Passer domesticus",  # Haussperling
    "Acrocephalus melanopogon",  # Mariskensänger
    "Sylvia atricapilla",  # Mönchsgrasmücke
    "Luscinia megarhynchos",  # Nachtigall
    "Locustella luscinioides",  # Rohrschwirl
    "Acrocephalus schoenobaenus",  # Schilfrohrsänger
    "Turdus philomelos",  # Singdrossel
    "Lanius collurio",  # Neuntöter
}

# The original 11's ``geschlechtsbestimmung_moeglich`` flags, curated by 0060
# from the sheet's "Geschlechtsbestimmung möglich" column. 0061's sheet has no
# such column, so the additive seed must leave these untouched.
ORIGINAL_GESCHLECHTSBESTIMMUNG = {
    "Acrocephalus scirpaceus": False,  # Teichrohrsänger
    "Panurus biarmicus": True,  # Bartmeise
    "Acrocephalus arundinaceus": False,  # Drosselrohrsänger
    "Passer domesticus": True,  # Haussperling
    "Acrocephalus melanopogon": False,  # Mariskensänger
    "Sylvia atricapilla": True,  # Mönchsgrasmücke
    "Luscinia megarhynchos": False,  # Nachtigall
    "Locustella luscinioides": False,  # Rohrschwirl
    "Acrocephalus schoenobaenus": False,  # Schilfrohrsänger
    "Turdus philomelos": False,  # Singdrossel
    "Lanius collurio": True,  # Neuntöter
}

# The 58 net-new species seeded by 0061 (issue #262), keyed by scientific_name
# (the migration's match key). Resolved from the sheet's German ``Artname D`` via
# the ``artenliste_2024.csv`` crosswalk; the 3 hand-resolved names are flagged.
NEW_SCIENTIFIC_NAMES = {
    "Troglodytes troglodytes",  # Zaunkönig
    "Acrocephalus palustris",  # Sumpfrohrsänger
    "Aegithalos caudatus",  # Schwanzmeise
    "Alcedo atthis",  # Eisvogel
    "Anthus trivialis",  # Baumpieper
    "Carduelis carduelis",  # Stieglitz
    "Chloris chloris",  # Grünling (hand-resolved)
    "Coccothraustes coccothraustes",  # Kernbeißer
    "Delichon urbicum",  # Mehlschwalbe
    "Dendrocopos major",  # Buntspecht
    "Dryobates minor",  # Kleinspecht
    "Emberiza citrinella",  # Goldammer
    "Emberiza schoeniclus",  # Rohrammer
    "Erithacus rubecula",  # Rotkehlchen
    "Ficedula hypoleuca",  # Trauerschnäpper
    "Fringilla coelebs",  # Buchfink
    "Hippolais icterina",  # Gelbspötter
    "Hirundo rustica",  # Rauchschwalbe
    "Jynx torquilla",  # Wendehals
    "Lanius excubitor",  # Raubwürger
    "Locustella fluviatilis",  # Schlagschwirl
    "Locustella naevia",  # Feldschwirl
    "Luscinia svecica",  # Blaukehlchen
    "Merops apiaster",  # Bienenfresser
    "Motacilla alba",  # Bachstelze
    "Motacilla flava",  # Schafstelze
    "Muscicapa striata",  # Grauschnäpper
    "Oriolus oriolus",  # Pirol
    "Periparus ater",  # Tannenmeise
    "Cyanistes caeruleus",  # Blaumeise
    "Parus major",  # Kohlmeise
    "Poecile palustris",  # Sumpfmeise
    "Passer montanus",  # Feldsperling
    "Phoenicurus ochruros",  # Hausrotschwanz
    "Phoenicurus phoenicurus",  # Gartenrotschwanz
    "Phylloscopus collybita",  # Zilpzalp
    "Phylloscopus trochilus",  # Fitis
    "Prunella modularis",  # Heckenbraunelle
    "Regulus regulus",  # Wintergoldhähnchen
    "Remiz pendulinus",  # Beutelmeise
    "Riparia riparia",  # Uferschwalbe
    "Saxicola rubetra",  # Braunkehlchen
    "Saxicola rubicola",  # Schwarzkehlchen (hand-resolved)
    "Serinus serinus",  # Girlitz
    "Sitta europaea",  # Kleiber
    "Sturnus vulgaris",  # Star
    "Sylvia borin",  # Gartengrasmücke
    "Curruca communis",  # Dorngrasmücke
    "Curruca curruca",  # Klappergrasmücke
    "Curruca nisoria",  # Sperbergrasmücke
    "Turdus merula",  # Amsel
    "Phylloscopus sibilatrix",  # Waldlaubsänger
    "Regulus ignicapilla",  # Sommergoldhähnchen
    "Gallinago gallinago",  # Bekassine (suspect source SD, shipped verbatim)
    "Spinus spinus",  # Erlenzeisig
    "Pyrrhula pyrrhula",  # Gimpel
    "Picus viridis",  # Grünspecht (suspect source SD, shipped verbatim)
    "Ficedula albicollis",  # Halsbandschnäpper (hand-resolved)
}


@pytest.fixture
def global_norms(db):
    """Every seeded globale Standard-Artennorm (``organization IS NULL``)."""
    return SpeciesNorm.objects.filter(organization__isnull=True).select_related("species")


@pytest.mark.django_db
def test_original_eleven_norms_remain_after_net_new_seed(global_norms):
    # 0061 is additive: 0060's original 11 global-default rows survive within the
    # 69 total, still matched by scientific_name (0 unmatched for the 11).
    assert len(SEED_SCIENTIFIC_NAMES) == 11
    seeded_names = {n.species.scientific_name for n in global_norms}
    assert SEED_SCIENTIFIC_NAMES <= seeded_names


@pytest.mark.django_db
def test_every_seeded_norm_is_a_global_default(global_norms):
    # Global default means organization IS NULL — never bound to a tenant.
    assert all(n.organization_id is None for n in global_norms)


@pytest.mark.django_db
def test_kerbe_f2_and_innenfuss_are_null_on_every_seeded_row(global_norms):
    # No Kerbe F2 / Innenfuß data yet: those four columns ship null everywhere.
    for norm in global_norms:
        assert norm.notch_f2_mean is None
        assert norm.notch_f2_sd is None
        assert norm.inner_foot_mean is None
        assert norm.inner_foot_sd is None


@pytest.mark.django_db
def test_dj_grossgefiedermauser_flag_absent_from_the_sheet_is_null(global_norms):
    # The sheet has no dj.-Großgefiedermauser column → the flag is null everywhere.
    assert all(n.dj_grossgefiedermauser_moeglich is None for n in global_norms)


@pytest.mark.django_db
def test_sd_factor_and_quotient_tolerance_defaults(global_norms):
    # The sheet's ±SD factor is 1.96 and its Quotient tolerance is 3 % on every row.
    for norm in global_norms:
        assert float(norm.sd_factor) == pytest.approx(1.96, abs=1e-6)
        assert float(norm.quotient_tolerance_pct) == pytest.approx(3.0, abs=1e-6)


@pytest.mark.django_db
def test_teichrohrsaenger_spot_check(db):
    # Spot-check the Ø/SD values against docs/Korrekturebenen.xlsx (row 2).
    norm = SpeciesNorm.objects.get(
        organization__isnull=True, species__scientific_name="Acrocephalus scirpaceus"
    )
    assert float(norm.weight_mean) == pytest.approx(11.3992, abs=1e-3)
    assert float(norm.weight_sd) == pytest.approx(1.748, abs=1e-3)
    assert float(norm.feather_mean) == pytest.approx(50.8685, abs=1e-3)
    assert float(norm.feather_sd) == pytest.approx(1.9598, abs=1e-3)
    assert float(norm.wing_mean) == pytest.approx(66.967, abs=1e-3)
    assert float(norm.wing_sd) == pytest.approx(8.2932, abs=1e-3)
    assert float(norm.quotient_mean) == pytest.approx(0.7634, abs=1e-4)
    assert float(norm.tarsus_mean) == pytest.approx(22.53005, abs=1e-3)
    assert float(norm.tarsus_sd) == pytest.approx(0.8196405, abs=1e-3)
    # Teichrohrsänger: Geschlechtsbestimmung nicht möglich ("nein" → False).
    assert norm.geschlechtsbestimmung_moeglich is False


@pytest.mark.django_db
def test_neuntoeter_spot_check_geschlechtsbestimmung_true(db):
    # Neuntöter (row 12): "ja" → True, and a spot value for the Ø.
    norm = SpeciesNorm.objects.get(
        organization__isnull=True, species__scientific_name="Lanius collurio"
    )
    assert norm.geschlechtsbestimmung_moeglich is True
    assert float(norm.weight_mean) == pytest.approx(27.5918, abs=1e-3)
    assert float(norm.wing_mean) == pytest.approx(93.7133, abs=1e-3)


@pytest.mark.django_db
def test_species_without_tarsus_in_sheet_have_null_tarsus(db):
    # Bartmeise / Haussperling / Mariskensänger have no Tarsus Ø/SD in the sheet.
    for scientific_name in (
        "Panurus biarmicus",
        "Passer domesticus",
        "Acrocephalus melanopogon",
    ):
        norm = SpeciesNorm.objects.get(
            organization__isnull=True, species__scientific_name=scientific_name
        )
        assert norm.tarsus_mean is None
        assert norm.tarsus_sd is None


# --- 0061: the 58 net-new globale Standard-Artennormen (issue #262) ---------


@pytest.mark.django_db
def test_total_global_defaults_after_net_new_seed(global_norms):
    # 0060 seeds 11 + 0061 seeds 58 net-new ⇒ 69 global-default rows total.
    assert global_norms.count() == 69


@pytest.mark.django_db
def test_all_fifty_eight_net_new_species_have_a_global_default(db):
    # Every one of the 58 net-new scientific_names got its own organization=NULL
    # row (0 unmatched ⇒ all 58 resolved against the Species seed).
    assert len(NEW_SCIENTIFIC_NAMES) == 58
    seeded = set(
        SpeciesNorm.objects.filter(
            organization__isnull=True,
            species__scientific_name__in=NEW_SCIENTIFIC_NAMES,
        ).values_list("species__scientific_name", flat=True)
    )
    assert seeded == NEW_SCIENTIFIC_NAMES


@pytest.mark.django_db
def test_net_new_seed_does_not_touch_the_original_eleven_flags(db):
    # The additive 0061 sheet has no Geschlechtsbestimmung column, so the 11
    # curated flags from 0060 must be exactly as they were — never backfilled.
    for scientific_name, expected in ORIGINAL_GESCHLECHTSBESTIMMUNG.items():
        norm = SpeciesNorm.objects.get(
            organization__isnull=True, species__scientific_name=scientific_name
        )
        assert norm.geschlechtsbestimmung_moeglich is expected


@pytest.mark.django_db
def test_kohlmeise_spot_check(db):
    # Kohlmeise = Parus major (parmaj), values verbatim from docs/Korrekturebenen.xlsx.
    norm = SpeciesNorm.objects.get(
        organization__isnull=True, species__scientific_name="Parus major"
    )
    assert float(norm.weight_mean) == pytest.approx(17.35913, abs=1e-3)
    assert float(norm.weight_sd) == pytest.approx(2.26843, abs=1e-3)
    assert float(norm.feather_mean) == pytest.approx(57.17013, abs=1e-3)
    assert float(norm.feather_sd) == pytest.approx(1.845595, abs=1e-3)
    assert float(norm.wing_mean) == pytest.approx(75.98384, abs=1e-3)
    assert float(norm.wing_sd) == pytest.approx(2.311891, abs=1e-3)
    assert float(norm.quotient_mean) == pytest.approx(0.7536138, abs=1e-4)
    assert float(norm.tarsus_mean) == pytest.approx(19.55082, abs=1e-3)
    assert float(norm.tarsus_sd) == pytest.approx(0.7816898, abs=1e-3)


@pytest.mark.django_db
def test_amsel_spot_check(db):
    # Amsel = Turdus merula (turmer), values verbatim from docs/Korrekturebenen.xlsx.
    norm = SpeciesNorm.objects.get(
        organization__isnull=True, species__scientific_name="Turdus merula"
    )
    assert float(norm.weight_mean) == pytest.approx(85.5965, abs=1e-3)
    assert float(norm.weight_sd) == pytest.approx(11.3203, abs=1e-3)
    assert float(norm.feather_mean) == pytest.approx(95.9448, abs=1e-3)
    assert float(norm.wing_mean) == pytest.approx(126.486, abs=1e-3)
    assert float(norm.wing_sd) == pytest.approx(9.5485, abs=1e-3)
    assert float(norm.quotient_mean) == pytest.approx(0.7765, abs=1e-4)
    assert float(norm.tarsus_mean) == pytest.approx(32.78609, abs=1e-3)
    assert float(norm.tarsus_sd) == pytest.approx(1.079659, abs=1e-3)


@pytest.mark.django_db
def test_hand_resolved_species_are_seeded(db):
    # Regression guard: the 3 species whose German name did NOT resolve directly
    # against artenliste_2024.csv and were hand-mapped are present.
    for scientific_name in (
        "Chloris chloris",  # Grünling
        "Saxicola rubicola",  # Schwarzkehlchen
        "Ficedula albicollis",  # Halsbandschnäpper
    ):
        assert SpeciesNorm.objects.filter(
            organization__isnull=True, species__scientific_name=scientific_name
        ).exists()


@pytest.mark.django_db
def test_new_rows_have_null_optional_columns_and_constant_factors(db):
    # On every net-new row: no Kerbe F2 / Innenfuß / flag columns in the sheet ⇒
    # those ship null; the ±SD factor is 1.96 and the Quotient tolerance is 3 %.
    new_norms = SpeciesNorm.objects.filter(
        organization__isnull=True,
        species__scientific_name__in=NEW_SCIENTIFIC_NAMES,
    )
    assert new_norms.count() == 58
    for norm in new_norms:
        assert norm.notch_f2_mean is None
        assert norm.notch_f2_sd is None
        assert norm.inner_foot_mean is None
        assert norm.inner_foot_sd is None
        assert norm.geschlechtsbestimmung_moeglich is None
        assert norm.dj_grossgefiedermauser_moeglich is None
        assert float(norm.sd_factor) == pytest.approx(1.96, abs=1e-6)
        assert float(norm.quotient_tolerance_pct) == pytest.approx(3.0, abs=1e-6)


@pytest.mark.django_db
def test_exactly_one_global_default_for_haussperling(db):
    # Haussperling (Passer domesticus) is one of the excluded 11 and the sheet's
    # duplicate row is moot: exactly one global default exists, never a second.
    assert (
        SpeciesNorm.objects.filter(
            organization__isnull=True, species__scientific_name="Passer domesticus"
        ).count()
        == 1
    )
