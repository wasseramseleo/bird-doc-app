import pytest
from django.contrib.auth.models import User

from birds.models import Mitgliedschaft, Scientist

# --- Admin-aware serializer (PRD #205, issue #206) ---------------------------
# For an Admin request the /scientists/ list/retrieve additionally exposes the
# Mitglied flag and the linked account's display name / email / Rolle. For any
# non-Admin request — and crucially when there is *no* Admin request context at
# all (offline reference bundle, mid-session autocomplete) — it returns exactly
# today's lean, leak-free shape. The account-field derivation is null-safe when
# the Beringer has no account and is scoped to the actor's active Organisation
# so it never leaks another tenant's data.

LEAN_FIELDS = {"id", "handle", "first_name", "last_name", "full_name"}


@pytest.mark.django_db
def test_admin_request_exposes_account_fields_for_mitglied_beringer(
    auth_client, membership, organization, mitglied_scientist, mitglied_user
):
    """An Admin listing /scientists/ sees, on an account-linked Beringer, the
    Mitglied flag and the linked account's display name / email / Rolle."""
    mitglied_user.first_name = "Mara"
    mitglied_user.last_name = "Moser"
    mitglied_user.email = "mara@example.org"
    mitglied_user.save()

    response = auth_client.get("/api/birds/scientists/")

    row = next(r for r in response.json()["results"] if r["handle"] == "MAR")
    assert row["is_member"] is True
    assert row["account"] == {
        "display_name": "Mara Moser",
        "email": "mara@example.org",
        "rolle": "mitglied",
    }


@pytest.mark.django_db
def test_admin_request_marks_no_account_beringer(auth_client, membership, organization):
    """A no-account Beringer is flagged is_member=False with a null account
    block (null-safe when Scientist.user is None)."""
    Scientist.objects.create(
        handle="FRE", first_name="Filip", last_name="Reiter", organization=organization
    )

    response = auth_client.get("/api/birds/scientists/")

    row = response.json()["results"][0]
    assert row["is_member"] is False
    assert row["account"] is None


@pytest.mark.django_db
def test_admin_retrieve_exposes_account_fields(
    auth_client, membership, organization, mitglied_scientist
):
    """The Admin-aware shape is on retrieve too, not just list."""
    response = auth_client.get(f"/api/birds/scientists/{mitglied_scientist.id}/")

    assert response.status_code == 200
    body = response.json()
    assert body["is_member"] is True
    assert body["account"]["rolle"] == "mitglied"


@pytest.mark.django_db
def test_non_admin_request_returns_lean_shape_without_account_fields(
    mitglied_client, mitglied_scientist, organization
):
    """A plain Mitglied's /scientists/ list is exactly the lean shape — the
    account fields never leak to a non-Admin."""
    response = mitglied_client.get("/api/birds/scientists/")

    row = response.json()["results"][0]
    assert set(row) == LEAN_FIELDS


@pytest.mark.django_db
def test_offline_bundle_beringer_is_lean_even_for_admin(auth_client, scientist, organization):
    """With no Admin request context (the offline reference bundle instantiates
    the serializer without a request) the Beringer shape is the lean, leak-free
    one even though the requester is an Admin and the Beringer is account-linked."""
    payload = auth_client.get("/api/birds/offline-bundle/").json()

    row = next(r for r in payload["scientists"] if r["handle"] == scientist.handle)
    assert set(row) == LEAN_FIELDS


@pytest.mark.django_db
def test_admin_account_rolle_is_scoped_to_actors_organisation(
    auth_client, membership, organization, organization_b
):
    """The account's Rolle is read in the *actor's* active Organisation, never
    another tenant's: a Beringer's linked account that is an Admin in another
    Organisation is still reported with its Rolle *here* — no cross-tenant leak."""
    dual = User.objects.create_user(username="dual", password="hunter2-very-strong")
    Mitgliedschaft.objects.create(
        user=dual, organization=organization, rolle=Mitgliedschaft.Rolle.MITGLIED
    )
    Mitgliedschaft.objects.create(
        user=dual, organization=organization_b, rolle=Mitgliedschaft.Rolle.ADMIN
    )
    Scientist.objects.create(user=dual, handle="DUL", organization=organization)

    response = auth_client.get("/api/birds/scientists/")

    row = next(r for r in response.json()["results"] if r["handle"] == "DUL")
    assert row["account"]["rolle"] == "mitglied"


@pytest.mark.django_db
def test_autocomplete_shows_only_active_organisations_beringer(
    auth_client, membership, organization, organization_b
):
    """The Beringer autocomplete is tenant-scoped: it shows only own-Organisation
    Beringer (Mitglieder + No-Account), never another tenant's (issue #74)."""
    mine = Scientist.objects.create(
        handle="FRE", first_name="Filip", last_name="Reiter", organization=organization
    )
    Scientist.objects.create(
        handle="BER", first_name="Berta", last_name="Fremd", organization=organization_b
    )

    response = auth_client.get("/api/birds/scientists/")

    handles = [row["handle"] for row in response.json()["results"]]
    assert handles == [mine.handle]


@pytest.mark.django_db
def test_two_tenant_beringer_isolation_includes_mitglieder_and_no_account(
    auth_client, auth_client_b, membership, organization, scientist_b, no_account_beringer_b
):
    """Two complete tenants: each Mitglied's autocomplete lists only its own
    Organisation's Beringer — both Mitglieder (``scientist_b``) and No-Account
    Beringer (``no_account_beringer_b``) — with no A↔B leakage (issue #74)."""
    mine = Scientist.objects.create(
        handle="FRE", first_name="Filip", last_name="Reiter", organization=organization
    )

    a = [row["handle"] for row in auth_client.get("/api/birds/scientists/").json()["results"]]
    b = [row["handle"] for row in auth_client_b.get("/api/birds/scientists/").json()["results"]]

    assert a == [mine.handle]
    assert set(b) == {scientist_b.handle, no_account_beringer_b.handle}


@pytest.mark.django_db
def test_cross_tenant_beringer_detail_returns_404(auth_client, membership, organization_b):
    """A cross-tenant Beringer detail fetch is a 404 (the row is invisible), not a
    403 (issue #74)."""
    foreign = Scientist.objects.create(
        handle="BER", first_name="Berta", last_name="Fremd", organization=organization_b
    )

    response = auth_client.get(f"/api/birds/scientists/{foreign.id}/")

    assert response.status_code == 404


@pytest.mark.django_db
def test_accountless_beringer_full_name_from_own_fields(auth_client, membership, organization):
    Scientist.objects.create(
        handle="FRE", first_name="Filip", last_name="Reiter", organization=organization
    )

    response = auth_client.get("/api/birds/scientists/")

    assert response.status_code == 200
    row = response.json()["results"][0]
    assert row["full_name"] == "Filip Reiter"


@pytest.mark.django_db
def test_full_name_falls_back_to_linked_user_when_own_fields_empty(
    auth_client, membership, organization, user
):
    user.first_name = "Alice"
    user.last_name = "Adams"
    user.save()
    Scientist.objects.create(user=user, handle="AAD", organization=organization)

    response = auth_client.get("/api/birds/scientists/")

    row = response.json()["results"][0]
    assert row["full_name"] == "Alice Adams"


@pytest.mark.django_db
def test_own_name_fields_take_precedence_over_linked_user(
    auth_client, membership, organization, user
):
    user.first_name = "Alice"
    user.last_name = "Adams"
    user.save()
    Scientist.objects.create(
        user=user, handle="FRE", first_name="Filip", last_name="Reiter", organization=organization
    )

    response = auth_client.get("/api/birds/scientists/")

    row = response.json()["results"][0]
    assert row["full_name"] == "Filip Reiter"


@pytest.mark.django_db
def test_search_matches_on_own_name_fields(auth_client, membership, organization):
    Scientist.objects.create(
        handle="FRE", first_name="Filip", last_name="Reiter", organization=organization
    )
    Scientist.objects.create(
        handle="JMU", first_name="Jana", last_name="Müller", organization=organization
    )

    response = auth_client.get("/api/birds/scientists/", {"search": "Reiter"})

    handles = [row["handle"] for row in response.json()["results"]]
    assert handles == ["FRE"]


@pytest.mark.django_db
def test_search_matches_on_handle(auth_client, membership, organization):
    Scientist.objects.create(
        handle="FRE", first_name="Filip", last_name="Reiter", organization=organization
    )
    Scientist.objects.create(
        handle="JMU", first_name="Jana", last_name="Müller", organization=organization
    )

    response = auth_client.get("/api/birds/scientists/", {"search": "FRE"})

    handles = [row["handle"] for row in response.json()["results"]]
    assert handles == ["FRE"]


@pytest.mark.django_db
def test_listing_is_ordered_by_own_last_name(auth_client, membership, organization):
    Scientist.objects.create(
        handle="JMU", first_name="Jana", last_name="Müller", organization=organization
    )
    Scientist.objects.create(
        handle="FRE", first_name="Filip", last_name="Reiter", organization=organization
    )
    Scientist.objects.create(
        handle="ABA", first_name="Anna", last_name="Bauer", organization=organization
    )

    response = auth_client.get("/api/birds/scientists/")

    handles = [row["handle"] for row in response.json()["results"]]
    assert handles == ["ABA", "JMU", "FRE"]


@pytest.mark.django_db
def test_authenticated_user_can_create_accountless_beringer(auth_client, membership, organization):
    response = auth_client.post(
        "/api/birds/scientists/",
        {"handle": "FRE", "first_name": "Filip", "last_name": "Reiter"},
        format="json",
    )

    assert response.status_code == 201
    beringer = Scientist.objects.get(handle="FRE")
    assert beringer.user is None
    assert beringer.full_name == "Filip Reiter"


@pytest.mark.django_db
def test_new_beringer_attaches_to_active_organisation(auth_client, membership, organization):
    """A quick-added No-Account Beringer attaches to the requester's active
    Organisation, so it is org-owned and appears only in that tenant's
    autocomplete (issue #74)."""
    response = auth_client.post(
        "/api/birds/scientists/",
        {"first_name": "Filip", "last_name": "Reiter"},
        format="json",
    )

    assert response.status_code == 201, response.json()
    assert Scientist.objects.get(handle="FRE").organization == organization


@pytest.mark.django_db
def test_create_beringer_rejected_without_active_organisation(auth_client):
    """Without a Mitgliedschaft there is no active Organisation to own the
    Beringer, so the quick-add is refused (issue #74)."""
    response = auth_client.post(
        "/api/birds/scientists/",
        {"first_name": "Filip", "last_name": "Reiter"},
        format="json",
    )

    assert response.status_code == 403
    assert not Scientist.objects.filter(first_name="Filip").exists()


@pytest.mark.django_db
def test_create_derives_kuerzel_when_omitted(auth_client, membership):
    response = auth_client.post(
        "/api/birds/scientists/",
        {"first_name": "Filip", "last_name": "Reiter"},
        format="json",
    )

    assert response.status_code == 201
    assert response.json()["handle"] == "FRE"
    assert Scientist.objects.get(first_name="Filip").handle == "FRE"


@pytest.mark.django_db
def test_create_respects_supplied_kuerzel(auth_client, membership):
    response = auth_client.post(
        "/api/birds/scientists/",
        {"first_name": "Filip", "last_name": "Reiter", "handle": "XYZ"},
        format="json",
    )

    assert response.status_code == 201
    assert response.json()["handle"] == "XYZ"


@pytest.mark.django_db
def test_create_matches_existing_beringer_by_kuerzel_instead_of_duplicating(
    auth_client, membership, organization
):
    """Offline sync (issue #167): a quick-added Beringer replayed after the same
    Kürzel was already created server-side (an online colleague, or a retried
    sync) matches the existing Beringer and returns it (200) rather than
    duplicating it or 400-ing on the unique constraint — so the offline device's
    dependent captures can resolve to the real id."""
    existing = Scientist.objects.create(
        handle="FRE", first_name="Filip", last_name="Reiter", organization=organization
    )

    response = auth_client.post(
        "/api/birds/scientists/",
        {"first_name": "Filip", "last_name": "Reiter", "handle": "FRE"},
        format="json",
    )

    assert response.status_code == 200, response.json()
    assert response.json()["id"] == existing.id
    assert Scientist.objects.filter(handle="FRE", organization=organization).count() == 1


@pytest.mark.django_db
def test_create_matches_existing_beringer_by_derived_kuerzel(auth_client, membership, organization):
    """The Kürzel match also holds when the client omits the handle: it is
    derived from the names first, so a replay of "Filip Reiter" still matches an
    existing FRE rather than duplicating (issue #167)."""
    existing = Scientist.objects.create(
        handle="FRE", first_name="Filip", last_name="Reiter", organization=organization
    )

    response = auth_client.post(
        "/api/birds/scientists/",
        {"first_name": "Filip", "last_name": "Reiter"},
        format="json",
    )

    assert response.status_code == 200, response.json()
    assert response.json()["id"] == existing.id
    assert Scientist.objects.filter(handle="FRE", organization=organization).count() == 1


@pytest.mark.django_db
def test_listing_excludes_reserved_fallback_beringer(auth_client, membership, organization):
    # The fallback Beringer (Kürzel GELÖSCHT) exists via data migration; it is
    # org-less, so the tenant scope already drops it, and it must stay hidden from
    # the autocomplete so no fresh capture is filed against it.
    Scientist.objects.create(
        handle="FRE", first_name="Filip", last_name="Reiter", organization=organization
    )

    response = auth_client.get("/api/birds/scientists/")

    handles = [row["handle"] for row in response.json()["results"]]
    assert "GELÖSCHT" not in handles
    assert handles == ["FRE"]


@pytest.mark.django_db
def test_search_never_matches_reserved_fallback_beringer(auth_client, membership):
    response = auth_client.get("/api/birds/scientists/", {"search": "Nutzer"})

    assert response.json()["results"] == []


@pytest.mark.django_db
def test_beringer_cannot_be_edited_or_deleted_via_api(auth_client):
    beringer = Scientist.objects.create(handle="FRE", first_name="Filip", last_name="Reiter")
    detail = f"/api/birds/scientists/{beringer.id}/"

    assert auth_client.put(detail, {"handle": "XXX"}, format="json").status_code == 405
    assert auth_client.patch(detail, {"handle": "XXX"}, format="json").status_code == 405
    assert auth_client.delete(detail).status_code == 405
