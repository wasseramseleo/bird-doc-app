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

from birds.models import Ring, SpeciesNorm, SpeciesRingSizeOverride

OVERRIDES_URL = "/api/birds/species-norm-overrides/"
NORMS_URL = "/api/birds/species-norms/"
RING_SIZE_OVERRIDES_URL = "/api/birds/species-ring-size-overrides/"


def _results(response):
    """The rows of a (possibly paginated) list response."""
    body = response.json()
    return body["results"] if isinstance(body, dict) and "results" in body else body


def _effective(client, species_id):
    """The resolved effective Artennorm row for ``species_id`` (or ``None``)."""
    rows = client.get(NORMS_URL).json()["norms"]
    return next((row for row in rows if row["species_id"] == str(species_id)), None)


def _effective_ring_size(client, species_id):
    """The Organisation's effective Empfohlene Ringgröße for ``species_id`` as the
    data-entry pre-fill sees it — i.e. the ``ring_size`` served on the species
    detail (override ?? global, ADR 0028)."""
    return client.get(f"/api/birds/species/{species_id}/").json()["ring_size"]


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


# =====================================================================
# Empfohlene Ringgröße — per-Organisation override (issue #372, ADR 0028)
# =====================================================================
# A standalone per-(species, org) ring-size override resolved **independently** of
# the whole-row Artennorm: it is its own table/resource, so setting or clearing a
# ring size neither creates nor disturbs a norm-override row and never toggles a
# plausibility check. Effective Empfohlene Ringgröße = org override ?? the global
# ``Species.ring_size`` (a null override = inherit). The ``species`` fixture ships
# a global ``ring_size`` of ``V``.


# --- Admin create / round-trip -----------------------------------------------


@pytest.mark.django_db
def test_admin_creates_a_ring_size_override(auth_client, membership, organization, species):
    """An Admin sets the Organisation's Empfohlene Ringgröße for a species (201);
    the row is org-scoped and lives in its own table, not on ``SpeciesNorm``."""
    response = auth_client.post(
        RING_SIZE_OVERRIDES_URL,
        {"species_id": str(species.id), "ring_size": Ring.RingSizes.S},
        format="json",
    )

    assert response.status_code == 201, response.json()
    override = SpeciesRingSizeOverride.objects.get(species=species, organization=organization)
    assert override.ring_size == Ring.RingSizes.S
    assert response.json()["species_id"] == str(species.id)
    assert response.json()["ring_size"] == Ring.RingSizes.S


@pytest.mark.django_db
def test_ring_size_override_round_trips_via_the_list(
    auth_client, membership, organization, species
):
    """The saved override round-trips: it comes back on the org-scoped list with
    its species, ring size and own id (for "Auf Standard zurücksetzen")."""
    auth_client.post(
        RING_SIZE_OVERRIDES_URL,
        {"species_id": str(species.id), "ring_size": Ring.RingSizes.T},
        format="json",
    )

    rows = _results(auth_client.get(RING_SIZE_OVERRIDES_URL))
    assert len(rows) == 1
    assert rows[0]["species_id"] == str(species.id)
    assert rows[0]["ring_size"] == Ring.RingSizes.T
    assert rows[0]["id"]


@pytest.mark.django_db
def test_ring_size_override_upserts_by_species(auth_client, membership, organization, species):
    """Save is idempotent by species within the Organisation: a second POST
    updates the ring size in place (200) rather than colliding on the unique
    (species, organization) constraint."""
    SpeciesRingSizeOverride.objects.create(
        species=species, organization=organization, ring_size=Ring.RingSizes.S
    )

    response = auth_client.post(
        RING_SIZE_OVERRIDES_URL,
        {"species_id": str(species.id), "ring_size": Ring.RingSizes.T},
        format="json",
    )

    assert response.status_code == 200, response.json()
    assert (
        SpeciesRingSizeOverride.objects.filter(species=species, organization=organization).count()
        == 1
    )
    override = SpeciesRingSizeOverride.objects.get(species=species, organization=organization)
    assert override.ring_size == Ring.RingSizes.T


@pytest.mark.django_db
def test_ring_size_override_created_is_always_org_scoped(
    auth_client, membership, organization, species
):
    """``organization`` is server-set to the actor's active Organisation — a client
    can neither plant another tenant's override nor a global default row."""
    auth_client.post(
        RING_SIZE_OVERRIDES_URL,
        {"species_id": str(species.id), "ring_size": Ring.RingSizes.S},
        format="json",
    )

    assert SpeciesRingSizeOverride.objects.get(species=species).organization == organization


@pytest.mark.django_db
def test_ring_size_override_rejects_an_unknown_size(auth_client, membership, organization, species):
    """A ring size outside the known scheme is a clean 400, not a stored row."""
    response = auth_client.post(
        RING_SIZE_OVERRIDES_URL,
        {"species_id": str(species.id), "ring_size": "ZZ"},
        format="json",
    )

    assert response.status_code == 400
    assert not SpeciesRingSizeOverride.objects.filter(species=species).exists()


# --- Effective resolution = override ?? global -------------------------------


@pytest.mark.django_db
def test_effective_ring_size_resolves_override_over_global(
    auth_client, auth_client_b, membership, scientist_b, organization, species
):
    """After Organisation A saves a ring-size override, A's effective Empfohlene
    Ringgröße resolves to it while Organisation B still inherits the global
    ``Species.ring_size`` (tenant-isolated coalesce)."""
    assert species.ring_size == Ring.RingSizes.V

    save = auth_client.post(
        RING_SIZE_OVERRIDES_URL,
        {"species_id": str(species.id), "ring_size": Ring.RingSizes.S},
        format="json",
    )
    assert save.status_code == 201, save.json()

    assert _effective_ring_size(auth_client, species.id) == Ring.RingSizes.S
    assert _effective_ring_size(auth_client_b, species.id) == Ring.RingSizes.V


@pytest.mark.django_db
def test_no_ring_size_override_inherits_the_global(auth_client, membership, organization, species):
    """A species with no override simply inherits the global default."""
    assert not SpeciesRingSizeOverride.objects.filter(species=species).exists()
    assert _effective_ring_size(auth_client, species.id) == species.ring_size


@pytest.mark.django_db
def test_deleting_ring_size_override_falls_back_to_the_global(
    auth_client, membership, organization, species
):
    """ "Auf Standard zurücksetzen": deleting the override makes the species inherit
    the global ``Species.ring_size`` again (null override = inherit)."""
    override = SpeciesRingSizeOverride.objects.create(
        species=species, organization=organization, ring_size=Ring.RingSizes.S
    )
    assert _effective_ring_size(auth_client, species.id) == Ring.RingSizes.S

    response = auth_client.delete(f"{RING_SIZE_OVERRIDES_URL}{override.id}/")

    assert response.status_code == 204
    assert not SpeciesRingSizeOverride.objects.filter(id=override.id).exists()
    assert _effective_ring_size(auth_client, species.id) == Ring.RingSizes.V


# --- Independence: ring size and the plausibility norms never touch each other -


@pytest.mark.django_db
def test_setting_ring_size_override_leaves_the_norm_columns_untouched(
    auth_client, membership, organization, species
):
    """Setting a ring-size override creates NO ``SpeciesNorm`` row and never toggles
    a plausibility check: a species with a global default norm still resolves to
    that default afterwards (ADR 0028 — ring size never rides the whole-row norm)."""
    SpeciesNorm.objects.create(
        species=species, organization=None, weight_mean=Decimal("9.10"), weight_sd=Decimal("0.82")
    )

    response = auth_client.post(
        RING_SIZE_OVERRIDES_URL,
        {"species_id": str(species.id), "ring_size": Ring.RingSizes.S},
        format="json",
    )
    assert response.status_code == 201, response.json()

    # No norm override row was minted — an all-null one would have disabled every
    # check for the Organisation.
    assert not SpeciesNorm.objects.filter(species=species, organization=organization).exists()
    # The effective norm is still the untouched global default.
    row = _effective(auth_client, species.id)
    assert Decimal(str(row["weight_mean"])) == Decimal("9.10")


@pytest.mark.django_db
def test_clearing_ring_size_override_leaves_the_norm_override_untouched(
    auth_client, membership, organization, species
):
    """Clearing the ring size (deleting its override) leaves an existing norm
    override completely intact (and vice-versa is structural — separate tables)."""
    norm = SpeciesNorm.objects.create(
        species=species,
        organization=organization,
        weight_mean=Decimal("12.00"),
        weight_sd=Decimal("1.00"),
    )
    ring_override = SpeciesRingSizeOverride.objects.create(
        species=species, organization=organization, ring_size=Ring.RingSizes.S
    )

    response = auth_client.delete(f"{RING_SIZE_OVERRIDES_URL}{ring_override.id}/")

    assert response.status_code == 204
    norm.refresh_from_db()
    assert norm.weight_mean == Decimal("12.000")
    assert Decimal(str(_effective(auth_client, species.id)["weight_mean"])) == Decimal("12.00")


@pytest.mark.django_db
def test_setting_norm_override_leaves_the_ring_size_untouched(
    auth_client, membership, organization, species
):
    """Vice-versa: saving a plausibility norm override neither creates a ring-size
    override nor changes the effective Empfohlene Ringgröße (still the global)."""
    response = auth_client.post(
        OVERRIDES_URL,
        {"species_id": str(species.id), "weight_mean": "12.00", "weight_sd": "1.00"},
        format="json",
    )
    assert response.status_code == 201, response.json()

    assert not SpeciesRingSizeOverride.objects.filter(species=species).exists()
    assert _effective_ring_size(auth_client, species.id) == species.ring_size


# --- Authorization: Admin-only writes, Mitglied read-only --------------------


@pytest.mark.django_db
def test_plain_mitglied_can_read_ring_size_overrides(
    mitglied_client, mitglied_scientist, organization, species
):
    SpeciesRingSizeOverride.objects.create(
        species=species, organization=organization, ring_size=Ring.RingSizes.S
    )

    response = mitglied_client.get(RING_SIZE_OVERRIDES_URL)

    assert response.status_code == 200
    assert [row["species_id"] for row in _results(response)] == [str(species.id)]


@pytest.mark.django_db
def test_plain_mitglied_cannot_create_a_ring_size_override(
    mitglied_client, mitglied_scientist, organization, species
):
    response = mitglied_client.post(
        RING_SIZE_OVERRIDES_URL,
        {"species_id": str(species.id), "ring_size": Ring.RingSizes.S},
        format="json",
    )

    assert response.status_code == 403
    assert not SpeciesRingSizeOverride.objects.filter(species=species).exists()


@pytest.mark.django_db
def test_plain_mitglied_cannot_delete_a_ring_size_override(
    mitglied_client, mitglied_scientist, organization, species
):
    override = SpeciesRingSizeOverride.objects.create(
        species=species, organization=organization, ring_size=Ring.RingSizes.S
    )

    response = mitglied_client.delete(f"{RING_SIZE_OVERRIDES_URL}{override.id}/")

    assert response.status_code == 403
    assert SpeciesRingSizeOverride.objects.filter(id=override.id).exists()


@pytest.mark.django_db
def test_ring_size_overrides_require_authentication(api_client):
    response = api_client.get(RING_SIZE_OVERRIDES_URL)
    assert response.status_code in (401, 403)


# --- Tenant isolation --------------------------------------------------------


@pytest.mark.django_db
def test_org_cannot_see_another_orgs_ring_size_override(
    auth_client, membership, organization, organization_b, species
):
    SpeciesRingSizeOverride.objects.create(
        species=species, organization=organization_b, ring_size=Ring.RingSizes.X
    )

    response = auth_client.get(RING_SIZE_OVERRIDES_URL)

    assert _results(response) == []


@pytest.mark.django_db
def test_cross_tenant_ring_size_override_delete_returns_404(
    auth_client, membership, organization_b, species
):
    foreign = SpeciesRingSizeOverride.objects.create(
        species=species, organization=organization_b, ring_size=Ring.RingSizes.X
    )

    response = auth_client.delete(f"{RING_SIZE_OVERRIDES_URL}{foreign.id}/")

    assert response.status_code == 404
    assert SpeciesRingSizeOverride.objects.filter(id=foreign.id).exists()
