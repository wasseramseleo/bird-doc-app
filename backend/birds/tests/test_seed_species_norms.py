"""Data-assertion tests for the 11 globale Standard-Artennormen seed (issue #250).

Migration ``0060_seed_species_norms`` embeds a static dict literal (Ø/SD values
extracted at build time from ``docs/Korrekturebenen.xlsx``) and writes one
``organization = NULL`` ``SpeciesNorm`` row per seed species, matched by
``scientific_name``. These tests assert the migration's *effect on the database*
after migrations run — external behaviour, not the migration's internals —
mirroring the prior art ``test_seed_demo_org.py``.
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


@pytest.fixture
def global_norms(db):
    """Every seeded globale Standard-Artennorm (``organization IS NULL``)."""
    return SpeciesNorm.objects.filter(organization__isnull=True).select_related("species")


@pytest.mark.django_db
def test_seeds_exactly_eleven_global_default_norms(global_norms):
    # The migration creates exactly 11 global-default rows, one per seed species,
    # matched by scientific_name (count == 11 ⇒ 0 unmatched).
    assert global_norms.count() == 11
    seeded_names = {n.species.scientific_name for n in global_norms}
    assert seeded_names == SEED_SCIENTIFIC_NAMES


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
