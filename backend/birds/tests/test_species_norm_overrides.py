"""Artennorm — Org-Admin override CRUD resource (PRD #245, issue #251, ADR 0016 +
ADR 0021).

The in-app editor tunes an Organisation's Artennormen by writing **override**
rows (``organization`` set); the shared **globale Standard-Artennormen**
(``organization IS NULL``) are never editable through this resource. Writes are
Admin-only, reads open to any Mitglied, and everything is org-scoped so one
Organisation can neither see nor mutate another's overrides. After an Admin
saves an override the Organisation's effective norm (the #246 ``override ??
default`` lookup) resolves to it while other Organisations still see the default.

Mirrors ``test_scientists.py`` (ADR 0016 Beringer-CRUD) and ``test_tenancy.py``
(tenant isolation).
"""

from decimal import Decimal

import pytest

from birds.models import SpeciesNorm

OVERRIDES_URL = "/api/birds/species-norm-overrides/"
NORMS_URL = "/api/birds/species-norms/"


def _results(response):
    """The rows of a (possibly paginated) list response."""
    body = response.json()
    return body["results"] if isinstance(body, dict) and "results" in body else body


def _effective(client, species_id):
    """The resolved effective Artennorm row for ``species_id`` (or ``None``)."""
    rows = client.get(NORMS_URL).json()["norms"]
    return next((row for row in rows if row["species_id"] == str(species_id)), None)


# --- Authentication ----------------------------------------------------------


@pytest.mark.django_db
def test_overrides_require_authentication(api_client):
    response = api_client.get(OVERRIDES_URL)
    assert response.status_code in (401, 403)


# --- Admin create / update (Save) --------------------------------------------


@pytest.mark.django_db
def test_admin_creates_an_override(auth_client, membership, organization, species):
    """An Admin creates an org override via POST (201); the row is org-scoped."""
    response = auth_client.post(
        OVERRIDES_URL,
        {"species_id": str(species.id), "weight_mean": "12.00", "weight_sd": "1.00"},
        format="json",
    )

    assert response.status_code == 201, response.json()
    override = SpeciesNorm.objects.get(species=species, organization=organization)
    assert override.weight_mean == Decimal("12.000")
    assert override.weight_sd == Decimal("1.000")
    assert response.json()["species_id"] == str(species.id)


@pytest.mark.django_db
def test_created_override_is_always_org_scoped_never_a_global_default(
    auth_client, membership, organization, species
):
    """The resource can never create a global-default (organization IS NULL) row:
    ``organization`` is server-set to the actor's active Organisation (AC: the API
    refuses to create a global default through the in-app resource)."""
    auth_client.post(
        OVERRIDES_URL,
        {"species_id": str(species.id), "weight_mean": "12.00", "weight_sd": "1.00"},
        format="json",
    )

    assert not SpeciesNorm.objects.filter(species=species, organization__isnull=True).exists()
    assert SpeciesNorm.objects.get(species=species).organization == organization


@pytest.mark.django_db
def test_admin_save_upserts_the_override_by_species(auth_client, membership, organization, species):
    """Save is idempotent by species within the Organisation: saving an override
    for a species that already has one updates it in place (200) rather than
    colliding on the unique (species, organization) constraint."""
    SpeciesNorm.objects.create(
        species=species,
        organization=organization,
        weight_mean=Decimal("12.00"),
        weight_sd=Decimal("1.00"),
    )

    response = auth_client.post(
        OVERRIDES_URL,
        {"species_id": str(species.id), "weight_mean": "15.00", "weight_sd": "2.00"},
        format="json",
    )

    assert response.status_code == 200, response.json()
    assert SpeciesNorm.objects.filter(species=species, organization=organization).count() == 1
    override = SpeciesNorm.objects.get(species=species, organization=organization)
    assert override.weight_mean == Decimal("15.000")


@pytest.mark.django_db
def test_admin_updates_an_override_via_patch(auth_client, membership, organization, species):
    override = SpeciesNorm.objects.create(
        species=species,
        organization=organization,
        weight_mean=Decimal("12.00"),
        weight_sd=Decimal("1.00"),
    )

    response = auth_client.patch(
        f"{OVERRIDES_URL}{override.id}/",
        {"weight_mean": "9.50"},
        format="json",
    )

    assert response.status_code == 200, response.json()
    override.refresh_from_db()
    assert override.weight_mean == Decimal("9.500")


# --- "Auf Standard zurücksetzen": delete falls back to the default -----------


@pytest.mark.django_db
def test_admin_deletes_an_override_and_it_falls_back_to_the_default(
    auth_client, membership, organization, species
):
    """Deleting the override ("Auf Standard zurücksetzen") makes the species
    resolve to the global default again via the #246 effective-norm lookup."""
    SpeciesNorm.objects.create(
        species=species, organization=None, weight_mean=Decimal("9.10"), weight_sd=Decimal("0.82")
    )
    override = SpeciesNorm.objects.create(
        species=species,
        organization=organization,
        weight_mean=Decimal("12.00"),
        weight_sd=Decimal("1.00"),
    )

    # Before the reset the Organisation resolves to the override.
    assert Decimal(str(_effective(auth_client, species.id)["weight_mean"])) == Decimal("12.00")

    response = auth_client.delete(f"{OVERRIDES_URL}{override.id}/")

    assert response.status_code == 204
    assert not SpeciesNorm.objects.filter(id=override.id).exists()
    # After the reset it falls back to the global default (whole-row resolution).
    assert Decimal(str(_effective(auth_client, species.id)["weight_mean"])) == Decimal("9.10")


# --- Clearing a single field disables just that check ------------------------


@pytest.mark.django_db
def test_clearing_a_field_in_the_override_disables_just_that_check(
    auth_client, membership, organization, species
):
    """A null column in the saved override switches off *that* check for the
    Organisation while the rest of the override applies (ADR 0021 whole-row)."""
    SpeciesNorm.objects.create(
        species=species,
        organization=None,
        weight_mean=Decimal("9.10"),
        weight_sd=Decimal("0.82"),
        feather_mean=Decimal("55.0"),
        feather_sd=Decimal("1.5"),
    )

    response = auth_client.post(
        OVERRIDES_URL,
        {
            "species_id": str(species.id),
            "weight_mean": "12.00",
            "weight_sd": "1.00",
            "feather_mean": None,
            "feather_sd": None,
        },
        format="json",
    )

    assert response.status_code == 201, response.json()
    override = SpeciesNorm.objects.get(species=species, organization=organization)
    assert override.feather_mean is None
    row = _effective(auth_client, species.id)
    assert Decimal(str(row["weight_mean"])) == Decimal("12.00")
    # The Federlänge check is off — never back-filled from the default.
    assert row["feather_mean"] is None


# --- Add-for-any-species, including one with no global default ---------------


@pytest.mark.django_db
def test_add_override_for_a_species_with_no_global_default(
    auth_client, membership, organization, species
):
    """An override can be added for a species that has no globale Standard-
    Artennorm; the Organisation then resolves to it (add-for-any-species)."""
    assert not SpeciesNorm.objects.filter(species=species).exists()

    response = auth_client.post(
        OVERRIDES_URL,
        {"species_id": str(species.id), "weight_mean": "8.00", "weight_sd": "0.50"},
        format="json",
    )

    assert response.status_code == 201, response.json()
    row = _effective(auth_client, species.id)
    assert row is not None
    assert Decimal(str(row["weight_mean"])) == Decimal("8.00")


# --- Plain Mitglied is read-only ---------------------------------------------


@pytest.mark.django_db
def test_plain_mitglied_can_read_overrides(
    mitglied_client, mitglied_scientist, organization, species
):
    SpeciesNorm.objects.create(
        species=species, organization=organization, weight_mean=Decimal("12.00")
    )

    response = mitglied_client.get(OVERRIDES_URL)

    assert response.status_code == 200
    assert [row["species_id"] for row in _results(response)] == [str(species.id)]


@pytest.mark.django_db
def test_plain_mitglied_cannot_create_an_override(
    mitglied_client, mitglied_scientist, organization, species
):
    response = mitglied_client.post(
        OVERRIDES_URL,
        {"species_id": str(species.id), "weight_mean": "12.00"},
        format="json",
    )

    assert response.status_code == 403
    assert not SpeciesNorm.objects.filter(species=species).exists()


@pytest.mark.django_db
def test_plain_mitglied_cannot_update_an_override(
    mitglied_client, mitglied_scientist, organization, species
):
    override = SpeciesNorm.objects.create(
        species=species, organization=organization, weight_mean=Decimal("12.00")
    )

    response = mitglied_client.patch(
        f"{OVERRIDES_URL}{override.id}/", {"weight_mean": "9.50"}, format="json"
    )

    assert response.status_code == 403
    override.refresh_from_db()
    assert override.weight_mean == Decimal("12.000")


@pytest.mark.django_db
def test_plain_mitglied_cannot_delete_an_override(
    mitglied_client, mitglied_scientist, organization, species
):
    override = SpeciesNorm.objects.create(
        species=species, organization=organization, weight_mean=Decimal("12.00")
    )

    response = mitglied_client.delete(f"{OVERRIDES_URL}{override.id}/")

    assert response.status_code == 403
    assert SpeciesNorm.objects.filter(id=override.id).exists()


# --- Tenant isolation --------------------------------------------------------


@pytest.mark.django_db
def test_org_cannot_see_another_orgs_override_in_the_list(
    auth_client, membership, organization, organization_b, species
):
    SpeciesNorm.objects.create(
        species=species, organization=organization_b, weight_mean=Decimal("99.0")
    )

    response = auth_client.get(OVERRIDES_URL)

    assert _results(response) == []


@pytest.mark.django_db
def test_cross_tenant_override_patch_returns_404(auth_client, membership, organization_b, species):
    foreign = SpeciesNorm.objects.create(
        species=species, organization=organization_b, weight_mean=Decimal("99.0")
    )

    response = auth_client.patch(
        f"{OVERRIDES_URL}{foreign.id}/", {"weight_mean": "1.0"}, format="json"
    )

    assert response.status_code == 404
    foreign.refresh_from_db()
    assert foreign.weight_mean == Decimal("99.000")


@pytest.mark.django_db
def test_cross_tenant_override_delete_returns_404(auth_client, membership, organization_b, species):
    foreign = SpeciesNorm.objects.create(
        species=species, organization=organization_b, weight_mean=Decimal("99.0")
    )

    response = auth_client.delete(f"{OVERRIDES_URL}{foreign.id}/")

    assert response.status_code == 404
    assert SpeciesNorm.objects.filter(id=foreign.id).exists()


# --- The resource refuses to touch a global-default row ----------------------


@pytest.mark.django_db
def test_global_defaults_never_appear_in_the_override_list(
    auth_client, membership, organization, species
):
    """A globale Standard-Artennorm (organization IS NULL) is not an override, so
    it never appears in the org-scoped CRUD list."""
    SpeciesNorm.objects.create(species=species, organization=None, weight_mean=Decimal("9.10"))

    response = auth_client.get(OVERRIDES_URL)

    assert _results(response) == []


@pytest.mark.django_db
def test_resource_refuses_to_edit_a_global_default(auth_client, membership, organization, species):
    """Editing a global-default row through the in-app resource is refused: it is
    absent from the org-scoped override queryset, so a PATCH is a 404 and the
    shared default is left intact."""
    default = SpeciesNorm.objects.create(
        species=species, organization=None, weight_mean=Decimal("9.10")
    )

    response = auth_client.patch(
        f"{OVERRIDES_URL}{default.id}/", {"weight_mean": "1.0"}, format="json"
    )

    assert response.status_code == 404
    default.refresh_from_db()
    assert default.weight_mean == Decimal("9.100")


@pytest.mark.django_db
def test_resource_refuses_to_delete_a_global_default(
    auth_client, membership, organization, species
):
    default = SpeciesNorm.objects.create(
        species=species, organization=None, weight_mean=Decimal("9.10")
    )

    response = auth_client.delete(f"{OVERRIDES_URL}{default.id}/")

    assert response.status_code == 404
    assert SpeciesNorm.objects.filter(id=default.id).exists()


# --- Effective-norm resolution after a save (AC) -----------------------------


@pytest.mark.django_db
def test_saved_override_resolves_for_the_actor_org_default_for_others(
    auth_client, auth_client_b, membership, scientist_b, organization, species
):
    """After an Admin of Organisation A saves an override, A's effective norm
    resolves to it while Organisation B still sees the global default (the #246
    lookup, tenant-isolated)."""
    SpeciesNorm.objects.create(
        species=species, organization=None, weight_mean=Decimal("9.10"), weight_sd=Decimal("0.82")
    )

    save = auth_client.post(
        OVERRIDES_URL,
        {"species_id": str(species.id), "weight_mean": "12.00", "weight_sd": "1.00"},
        format="json",
    )
    assert save.status_code == 201, save.json()

    assert Decimal(str(_effective(auth_client, species.id)["weight_mean"])) == Decimal("12.00")
    assert Decimal(str(_effective(auth_client_b, species.id)["weight_mean"])) == Decimal("9.10")
