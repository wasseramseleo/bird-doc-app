from datetime import UTC, datetime

import pytest
from django.contrib.auth.models import User

from birds.models import (
    FALLBACK_BERINGER_HANDLE,
    DataEntry,
    Mitgliedschaft,
    Ring,
    Scientist,
)

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


# --- Add & edit a Beringer (PRD #205, issue #207) ----------------------------
# Add reuses the open, idempotent-by-Kürzel create (covered above). Edit is a new
# Admin-only PATCH of the Beringer's name + Kürzel; a plain Mitglied is refused
# (403) and a cross-tenant target is invisible (404). The globally-unique Kürzel
# surfaces a duplicate as a clean German 400, never a 500, and editing a name
# leaves an already-set Kürzel untouched. Delete stays closed (issue #208).


@pytest.mark.django_db
def test_admin_can_edit_beringer_name_and_kuerzel(auth_client, membership, no_account_beringer):
    """An Admin edits a Beringer's first name, last name and Kürzel via PATCH."""
    response = auth_client.patch(
        f"/api/birds/scientists/{no_account_beringer.id}/",
        {"first_name": "Nora", "last_name": "Neu", "handle": "NNE"},
        format="json",
    )

    assert response.status_code == 200, response.json()
    no_account_beringer.refresh_from_db()
    assert no_account_beringer.first_name == "Nora"
    assert no_account_beringer.last_name == "Neu"
    assert no_account_beringer.handle == "NNE"


@pytest.mark.django_db
def test_plain_mitglied_cannot_edit_beringer(
    mitglied_client, mitglied_scientist, no_account_beringer
):
    """Editing a Beringer is Admin-only (ADR 0005): a plain Mitglied's PATCH is
    refused with 403 and the Beringer is left unchanged. The quick-add create
    stays open to the same Mitglied (covered above)."""
    response = mitglied_client.patch(
        f"/api/birds/scientists/{no_account_beringer.id}/",
        {"first_name": "Hacked"},
        format="json",
    )

    assert response.status_code == 403
    no_account_beringer.refresh_from_db()
    assert no_account_beringer.first_name == "Nina"


@pytest.mark.django_db
def test_cross_tenant_beringer_patch_returns_404(auth_client, membership, no_account_beringer_b):
    """A cross-tenant Beringer PATCH is a 404 (the row is absent from the actor's
    tenant-scoped queryset), never a leak (issue #74)."""
    response = auth_client.patch(
        f"/api/birds/scientists/{no_account_beringer_b.id}/",
        {"first_name": "Hacked"},
        format="json",
    )

    assert response.status_code == 404
    no_account_beringer_b.refresh_from_db()
    assert no_account_beringer_b.first_name == "Berta"


@pytest.mark.django_db
def test_duplicate_kuerzel_edit_returns_clean_400_with_german_message(
    auth_client, membership, organization, no_account_beringer
):
    """Editing a Beringer to a Kürzel another Beringer already owns is a clean
    400 with a German validation message — the global unique constraint is
    surfaced gracefully, never as an IntegrityError 500."""
    Scientist.objects.create(
        handle="FRE", first_name="Filip", last_name="Reiter", organization=organization
    )

    response = auth_client.patch(
        f"/api/birds/scientists/{no_account_beringer.id}/",
        {"handle": "FRE"},
        format="json",
    )

    assert response.status_code == 400
    assert "Kürzel" in str(response.json()["handle"])
    no_account_beringer.refresh_from_db()
    assert no_account_beringer.handle != "FRE"


@pytest.mark.django_db
def test_editing_name_leaves_already_set_kuerzel_unchanged(
    auth_client, membership, no_account_beringer
):
    """Editing a Beringer's name without touching the Kürzel leaves an already-set
    Kürzel untouched — it is not re-derived from the new name (model behaviour)."""
    original_handle = no_account_beringer.handle

    response = auth_client.patch(
        f"/api/birds/scientists/{no_account_beringer.id}/",
        {"first_name": "Ganz", "last_name": "Anders"},
        format="json",
    )

    assert response.status_code == 200, response.json()
    no_account_beringer.refresh_from_db()
    assert no_account_beringer.handle == original_handle
    assert no_account_beringer.first_name == "Ganz"


@pytest.mark.django_db
def test_delete_unlinked_beringer_without_captures_hard_deletes(
    auth_client, membership, no_account_beringer
):
    """An Admin's DELETE of an unlinked Beringer that owns no captures hard-deletes
    it (204): the row is gone (issue #208 enables the delete #207 kept closed)."""
    response = auth_client.delete(f"/api/birds/scientists/{no_account_beringer.id}/")

    assert response.status_code == 204
    assert not Scientist.objects.filter(id=no_account_beringer.id).exists()


# --- Link / unlink a Beringer to a seat (PRD #205, issue #209) ----------------
# The Admin PATCH carries a write-only, Admin-only ``mitgliedschaft_id`` that
# addresses the link BY SEAT: a seat id attaches the Beringer to that seat's
# account (``Scientist.user = mitgliedschaft.user``), promoting a no-account
# Beringer to a Mitglied; ``null`` detaches it. The freeze-once-captures invariant
# guards the reversibility: attaching a currently-unlinked Beringer is always
# allowed (even with captures — the primary workflow), but detaching or
# re-pointing an already-linked Beringer that owns captures is refused (400).
# Linking is refused (400) for a cross-tenant seat or one whose account already
# has a Scientist. The idempotent quick-add create stays link-free.


def _capture(beringer, species, ring, ringing_station):
    """A DataEntry filed against ``beringer`` (its staff), so it 'owns captures'."""
    return DataEntry.objects.create(
        species=species,
        ring=ring,
        staff=beringer,
        ringing_station=ringing_station,
        date_time=datetime(2026, 1, 1, 12, 0, tzinfo=UTC),
    )


@pytest.mark.django_db
def test_admin_attaches_unlinked_beringer_to_seat_promotes_to_mitglied(
    auth_client, membership, gap_seat, no_account_beringer, species, ring, ringing_station
):
    """An Admin attaches an unlinked Beringer to a same-org seat via
    ``PATCH {mitgliedschaft_id}`` — allowed even when the Beringer already owns
    captures (the primary workflow) — promoting it to a Mitglied."""
    _capture(no_account_beringer, species, ring, ringing_station)

    response = auth_client.patch(
        f"/api/birds/scientists/{no_account_beringer.id}/",
        {"mitgliedschaft_id": str(gap_seat.id)},
        format="json",
    )

    assert response.status_code == 200, response.json()
    no_account_beringer.refresh_from_db()
    assert no_account_beringer.user_id == gap_seat.user_id
    assert response.json()["is_member"] is True


@pytest.mark.django_db
def test_admin_detaches_capture_free_linked_beringer_demotes(
    auth_client, membership, organization, gap_seat
):
    """An Admin detaches a capture-free linked Beringer via
    ``PATCH {mitgliedschaft_id: null}``, demoting it back to a no-account
    Beringer (a reversible demote)."""
    linked = Scientist.objects.create(user=gap_seat.user, handle="LNK", organization=organization)

    response = auth_client.patch(
        f"/api/birds/scientists/{linked.id}/",
        {"mitgliedschaft_id": None},
        format="json",
    )

    assert response.status_code == 200, response.json()
    linked.refresh_from_db()
    assert linked.user_id is None
    assert response.json()["is_member"] is False


@pytest.mark.django_db
def test_detach_of_capture_owner_is_refused_400(
    auth_client, membership, organization, gap_seat, species, ring, ringing_station
):
    """Detaching an already-linked Beringer that owns captures is refused (400) —
    the freeze-once-captures invariant keeps its capture history attributable."""
    linked = Scientist.objects.create(user=gap_seat.user, handle="LNK", organization=organization)
    _capture(linked, species, ring, ringing_station)

    response = auth_client.patch(
        f"/api/birds/scientists/{linked.id}/",
        {"mitgliedschaft_id": None},
        format="json",
    )

    assert response.status_code == 400
    linked.refresh_from_db()
    assert linked.user_id == gap_seat.user_id


@pytest.mark.django_db
def test_repoint_of_capture_owner_is_refused_400(
    auth_client, membership, organization, gap_seat, species, ring, ringing_station
):
    """Re-pointing an already-linked Beringer that owns captures to another seat is
    refused (400) — the same freeze-once-captures invariant as detaching."""
    linked = Scientist.objects.create(user=gap_seat.user, handle="LNK", organization=organization)
    _capture(linked, species, ring, ringing_station)
    other_seat = Mitgliedschaft.objects.create(
        user=User.objects.create_user(username="other", password="hunter2-very-strong"),
        organization=organization,
        rolle=Mitgliedschaft.Rolle.MITGLIED,
    )

    response = auth_client.patch(
        f"/api/birds/scientists/{linked.id}/",
        {"mitgliedschaft_id": str(other_seat.id)},
        format="json",
    )

    assert response.status_code == 400
    linked.refresh_from_db()
    assert linked.user_id == gap_seat.user_id


@pytest.mark.django_db
def test_link_refused_when_seat_is_cross_tenant_400(
    auth_client, membership, no_account_beringer, organization_b
):
    """Linking to a seat in another Organisation is refused (400) — the tenant
    boundary holds even though the seat resolves to a real account."""
    foreign_seat = Mitgliedschaft.objects.create(
        user=User.objects.create_user(username="brenda", password="hunter2-very-strong"),
        organization=organization_b,
        rolle=Mitgliedschaft.Rolle.MITGLIED,
    )

    response = auth_client.patch(
        f"/api/birds/scientists/{no_account_beringer.id}/",
        {"mitgliedschaft_id": str(foreign_seat.id)},
        format="json",
    )

    assert response.status_code == 400
    no_account_beringer.refresh_from_db()
    assert no_account_beringer.user_id is None


@pytest.mark.django_db
def test_link_refused_when_seat_account_already_has_scientist_400(
    auth_client, membership, no_account_beringer, mitglied_scientist
):
    """Linking to a seat whose account already has a Scientist is refused (400) —
    the OneToOne ``Scientist.user`` must be free to attach."""
    taken_seat = Mitgliedschaft.objects.get(user=mitglied_scientist.user)

    response = auth_client.patch(
        f"/api/birds/scientists/{no_account_beringer.id}/",
        {"mitgliedschaft_id": str(taken_seat.id)},
        format="json",
    )

    assert response.status_code == 400
    no_account_beringer.refresh_from_db()
    assert no_account_beringer.user_id is None


@pytest.mark.django_db
def test_plain_mitglied_cannot_link_beringer_to_seat_403(
    mitglied_client, mitglied_scientist, gap_seat, no_account_beringer
):
    """Linking a Beringer to a seat is an Admin power (the PATCH is IsOrgAdmin-
    gated): a plain Mitglied's attempt is refused with 403, unchanged."""
    response = mitglied_client.patch(
        f"/api/birds/scientists/{no_account_beringer.id}/",
        {"mitgliedschaft_id": str(gap_seat.id)},
        format="json",
    )

    assert response.status_code == 403
    no_account_beringer.refresh_from_db()
    assert no_account_beringer.user_id is None


@pytest.mark.django_db
def test_cross_tenant_target_link_returns_404(
    auth_client, membership, no_account_beringer_b, gap_seat
):
    """A PATCH linking a Beringer that lives in another tenant is a 404 — the
    target is absent from the actor's tenant-scoped queryset, never a leak."""
    response = auth_client.patch(
        f"/api/birds/scientists/{no_account_beringer_b.id}/",
        {"mitgliedschaft_id": str(gap_seat.id)},
        format="json",
    )

    assert response.status_code == 404
    no_account_beringer_b.refresh_from_db()
    assert no_account_beringer_b.user_id is None


@pytest.mark.django_db
def test_quick_add_create_ignores_mitgliedschaft_id(auth_client, membership, gap_seat):
    """The idempotent quick-add create is link-free: a ``mitgliedschaft_id`` in the
    create payload is ignored, so the new Beringer stays a no-account Beringer."""
    response = auth_client.post(
        "/api/birds/scientists/",
        {"first_name": "Filip", "last_name": "Reiter", "mitgliedschaft_id": str(gap_seat.id)},
        format="json",
    )

    assert response.status_code == 201, response.json()
    assert Scientist.objects.get(handle="FRE").user_id is None


# --- Delete a Beringer: reassign-or-block (PRD #205, issue #208) ---------------
# Deleting a Beringer is Admin-only and reuses the ADR 0003 reassignment model
# (``DataEntry.staff`` is ``on_delete=SET(get_fallback_beringer)``). An unlinked
# Beringer with no captures hard-deletes (204); an unlinked Beringer that owns
# captures deletes too (204) but its captures are reassigned to the reserved
# "Gelöschter Nutzer" fallback rather than lost. A linked Mitglied is refused
# server-side (409) — an active member is never stripped of their Beringer
# identity from this screen. Cross-tenant is a 404, a non-Admin a 403. To let the
# frontend name the Fänge count in its confirmation, the Admin-aware serializer
# exposes an Admin-only ``capture_count`` read field (never leaked to a non-Admin
# or context-free read).


@pytest.mark.django_db
def test_delete_unlinked_beringer_with_captures_reassigns_to_fallback(
    auth_client, membership, organization, species, ring, ringing_station
):
    """An Admin's DELETE of an unlinked Beringer that owns captures deletes it (204)
    but reassigns its captures to the reserved 'Gelöschter Nutzer' fallback — the
    ADR 0003 model-layer SET, so capture data is never lost."""
    owner = Scientist.objects.create(
        handle="OWN", first_name="Otto", last_name="Owner", organization=organization
    )
    capture = _capture(owner, species, ring, ringing_station)

    response = auth_client.delete(f"/api/birds/scientists/{owner.id}/")

    assert response.status_code == 204
    assert not Scientist.objects.filter(id=owner.id).exists()
    capture.refresh_from_db()
    assert capture.staff.handle == FALLBACK_BERINGER_HANDLE


@pytest.mark.django_db
def test_delete_linked_mitglied_beringer_is_refused(auth_client, membership, mitglied_scientist):
    """Deleting a Beringer that is a linked Mitglied is refused server-side (409):
    an active member is never stripped of their Beringer identity from this screen,
    so the Beringer still exists afterwards."""
    response = auth_client.delete(f"/api/birds/scientists/{mitglied_scientist.id}/")

    assert response.status_code == 409
    assert Scientist.objects.filter(id=mitglied_scientist.id).exists()


@pytest.mark.django_db
def test_cross_tenant_beringer_delete_returns_404(auth_client, membership, no_account_beringer_b):
    """A cross-tenant Beringer DELETE is a 404 (the row is absent from the actor's
    tenant-scoped queryset), never a leak (issue #74); the Beringer survives."""
    response = auth_client.delete(f"/api/birds/scientists/{no_account_beringer_b.id}/")

    assert response.status_code == 404
    assert Scientist.objects.filter(id=no_account_beringer_b.id).exists()


@pytest.mark.django_db
def test_plain_mitglied_cannot_delete_beringer(
    mitglied_client, mitglied_scientist, no_account_beringer
):
    """Deleting a Beringer is Admin-only (ADR 0005): a plain Mitglied's DELETE is
    refused with 403 and the Beringer is left intact."""
    response = mitglied_client.delete(f"/api/birds/scientists/{no_account_beringer.id}/")

    assert response.status_code == 403
    assert Scientist.objects.filter(id=no_account_beringer.id).exists()


@pytest.mark.django_db
def test_admin_shape_exposes_capture_count(
    auth_client, membership, organization, species, ring, ringing_station
):
    """For an Admin request the serializer exposes a ``capture_count`` read field —
    the number of Fänge the Beringer owns — so the delete confirmation can name it."""
    owner = Scientist.objects.create(
        handle="OWN", first_name="Otto", last_name="Owner", organization=organization
    )
    second_ring = Ring.objects.create(number="101", size=Ring.RingSizes.V)
    _capture(owner, species, ring, ringing_station)
    _capture(owner, species, second_ring, ringing_station)

    response = auth_client.get(f"/api/birds/scientists/{owner.id}/")

    assert response.status_code == 200
    assert response.json()["capture_count"] == 2


@pytest.mark.django_db
def test_capture_count_is_not_leaked_to_non_admin(
    mitglied_client, mitglied_scientist, organization
):
    """The ``capture_count`` field lives in the Admin-only block: a plain Mitglied's
    /scientists/ read is exactly the lean shape and never carries it."""
    response = mitglied_client.get("/api/birds/scientists/")

    row = response.json()["results"][0]
    assert "capture_count" not in row
    assert set(row) == LEAN_FIELDS
