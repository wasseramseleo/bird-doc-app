"""Artennorm (SpeciesNorm) — the two-layer per-species measurement norms and
the per-org effective-norm read API (PRD #245, issue #246, ADR 0021).

A ``SpeciesNorm`` row is either the **globale Standard-Artennorm**
(``organization IS NULL``) or an Organisation's **override**. The effective
norm for a species in an Organisation is the override row if one exists, else
the global default — resolved **whole-row**, never a per-column merge. The read
API and the offline bundle both expose that resolved per-org list keyed by
``species_id``.
"""

from decimal import Decimal

import pytest
from django.db import IntegrityError, transaction

from birds.models import SpeciesNorm

NORMS_URL = "/api/birds/species-norms/"


def _norm(species, organization=None, **columns):
    defaults = {"weight_mean": Decimal("9.10"), "weight_sd": Decimal("0.82")}
    defaults.update(columns)
    return SpeciesNorm.objects.create(species=species, organization=organization, **defaults)


def _by_species(payload, species_id):
    rows = payload["norms"] if isinstance(payload, dict) else payload
    return next((row for row in rows if row["species_id"] == str(species_id)), None)


# --- Model: constraints ------------------------------------------------------


@pytest.mark.django_db
def test_sd_factor_defaults_to_1_96(species):
    norm = _norm(species)
    assert norm.sd_factor == Decimal("1.96")


@pytest.mark.django_db
def test_rule_columns_are_nullable_null_means_check_off(species):
    """Every rule column is optional — a norm may set only the Gewicht band and
    leave every other check (and both flags) null."""
    norm = SpeciesNorm.objects.create(species=species, weight_mean=None, weight_sd=None)
    assert norm.feather_mean is None
    assert norm.quotient_mean is None
    assert norm.geschlechtsbestimmung_moeglich is None
    assert norm.dj_grossgefiedermauser_moeglich is None


@pytest.mark.django_db
def test_only_one_global_default_per_species(species):
    """The partial-unique index forbids a second global default (organization
    IS NULL) for one species."""
    _norm(species, organization=None)
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            _norm(species, organization=None)


@pytest.mark.django_db
def test_a_global_default_and_an_org_override_coexist(species, organization):
    """A species may carry both its global default and an Organisation's
    override — the partial index only guards the NULL-org row."""
    _norm(species, organization=None)
    _norm(species, organization=organization)
    assert SpeciesNorm.objects.filter(species=species).count() == 2


@pytest.mark.django_db
def test_one_override_per_species_and_org(species, organization):
    _norm(species, organization=organization)
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            _norm(species, organization=organization)


@pytest.mark.django_db
def test_two_orgs_may_each_override_the_same_species(species, organization, organization_b):
    _norm(species, organization=organization)
    _norm(species, organization=organization_b)
    assert SpeciesNorm.objects.filter(species=species).count() == 2


# --- Read API: per-org effective norm resolution -----------------------------


@pytest.mark.django_db
def test_norms_requires_authentication(api_client):
    response = api_client.get(NORMS_URL)
    assert response.status_code in (401, 403)


@pytest.mark.django_db
def test_species_with_only_a_global_default_resolves_to_the_default(
    auth_client, scientist, organization, species
):
    _norm(species, organization=None, weight_mean=Decimal("9.10"), weight_sd=Decimal("0.82"))
    payload = auth_client.get(NORMS_URL).json()
    row = _by_species(payload, species.id)
    assert row is not None
    assert Decimal(str(row["weight_mean"])) == Decimal("9.10")
    assert Decimal(str(row["weight_sd"])) == Decimal("0.82")


@pytest.mark.django_db
def test_org_override_replaces_the_whole_default_row(auth_client, scientist, organization, species):
    """The override wins as a whole row (ADR 0021): a cleared column in the
    override switches that check off, it is never back-filled from the default."""
    _norm(
        species,
        organization=None,
        weight_mean=Decimal("9.10"),
        weight_sd=Decimal("0.82"),
        feather_mean=Decimal("55.0"),
        feather_sd=Decimal("1.5"),
    )
    _norm(
        species,
        organization=organization,
        weight_mean=Decimal("12.00"),
        weight_sd=Decimal("1.00"),
        feather_mean=None,
        feather_sd=None,
    )

    payload = auth_client.get(NORMS_URL).json()
    row = _by_species(payload, species.id)
    assert Decimal(str(row["weight_mean"])) == Decimal("12.00")
    # The default's Federlänge band is NOT inherited — the override cleared it.
    assert row["feather_mean"] is None


@pytest.mark.django_db
def test_species_with_neither_default_nor_override_is_absent(
    auth_client, scientist, organization, species
):
    payload = auth_client.get(NORMS_URL).json()
    assert _by_species(payload, species.id) is None


@pytest.mark.django_db
def test_another_orgs_override_never_leaks_and_default_still_applies(
    auth_client, scientist, organization, species, organization_b
):
    """Tenant isolation: another Organisation's override must not be seen; this
    Organisation falls back to the global default."""
    _norm(species, organization=None, weight_mean=Decimal("9.10"), weight_sd=Decimal("0.82"))
    _norm(species, organization=organization_b, weight_mean=Decimal("99.0"), weight_sd=Decimal("9"))

    payload = auth_client.get(NORMS_URL).json()
    row = _by_species(payload, species.id)
    assert Decimal(str(row["weight_mean"])) == Decimal("9.10")


@pytest.mark.django_db
def test_norm_row_carries_species_name_for_the_warning_message(
    auth_client, scientist, organization, species
):
    """Each resolved norm carries the species common name so the client can name
    the Art in the Plausibilitätswarnung (…"(Zaunkönig)")."""
    _norm(species, organization=None)
    payload = auth_client.get(NORMS_URL).json()
    row = _by_species(payload, species.id)
    assert row["species_name"] == species.common_name_de


@pytest.mark.django_db
def test_norms_without_active_organization_is_empty_not_error(auth_client, species):
    _norm(species, organization=None)
    response = auth_client.get(NORMS_URL)
    assert response.status_code == 200
    assert _by_species(response.json(), species.id) is None
