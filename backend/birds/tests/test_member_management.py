"""Member management: an Admin removes Mitglieder and flips Rollen (issue #83).

Managing Mitgliedschaften is Admin-only (issue #76) and scoped to the active
Organisation (ADR 0005), so a cross-tenant membership is simply absent — a 404,
not a 403. The Organisation can never be left without an Admin.
"""

import pytest

from birds.models import Mitgliedschaft, Scientist

LIST_URL = "/api/birds/mitgliedschaften/"


def _detail_url(membership):
    return f"{LIST_URL}{membership.pk}/"


@pytest.mark.django_db
def test_admin_lists_own_organisations_members_only(
    auth_client, scientist, mitglied_scientist, scientist_b
):
    """The Admin sees their Organisation's Mitgliedschaften (their own + the
    Mitglied's) — never another tenant's."""
    response = auth_client.get(LIST_URL)

    assert response.status_code == 200
    usernames = {row["username"] for row in response.json()["results"]}
    assert usernames == {"alice", "mara"}
    assert "bruno" not in usernames


@pytest.mark.django_db
def test_plain_mitglied_cannot_list_members(mitglied_client, mitglied_scientist):
    response = mitglied_client.get(LIST_URL)

    assert response.status_code == 403
    assert "Administrator" in response.json()["detail"]


@pytest.mark.django_db
def test_admin_promotes_a_mitglied_to_admin(auth_client, scientist, mitglied_scientist):
    membership = Mitgliedschaft.objects.get(user=mitglied_scientist.user)

    response = auth_client.patch(
        _detail_url(membership), {"rolle": Mitgliedschaft.Rolle.ADMIN}, format="json"
    )

    assert response.status_code == 200
    membership.refresh_from_db()
    assert membership.rolle == Mitgliedschaft.Rolle.ADMIN


@pytest.mark.django_db
def test_admin_demotes_another_admin_to_mitglied(
    auth_client, scientist, mitglied_user, organization
):
    """With two Admins, one can be demoted — the Organisation keeps an Admin."""
    other_admin = Mitgliedschaft.objects.create(
        user=mitglied_user, organization=organization, rolle=Mitgliedschaft.Rolle.ADMIN
    )

    response = auth_client.patch(
        _detail_url(other_admin), {"rolle": Mitgliedschaft.Rolle.MITGLIED}, format="json"
    )

    assert response.status_code == 200
    other_admin.refresh_from_db()
    assert other_admin.rolle == Mitgliedschaft.Rolle.MITGLIED


@pytest.mark.django_db
def test_admin_removes_a_mitglied(auth_client, scientist, mitglied_scientist):
    membership = Mitgliedschaft.objects.get(user=mitglied_scientist.user)

    response = auth_client.delete(_detail_url(membership))

    assert response.status_code == 204
    assert not Mitgliedschaft.objects.filter(pk=membership.pk).exists()


@pytest.mark.django_db
def test_cannot_remove_the_last_admin(auth_client, scientist):
    """Alice is the only Admin of her Organisation; removing her is refused so the
    Organisation is never left without an Admin."""
    membership = Mitgliedschaft.objects.get(user=scientist.user)

    response = auth_client.delete(_detail_url(membership))

    assert response.status_code == 400
    assert "Administrator" in str(response.json())
    assert Mitgliedschaft.objects.filter(pk=membership.pk).exists()


@pytest.mark.django_db
def test_cannot_demote_the_last_admin(auth_client, scientist):
    membership = Mitgliedschaft.objects.get(user=scientist.user)

    response = auth_client.patch(
        _detail_url(membership), {"rolle": Mitgliedschaft.Rolle.MITGLIED}, format="json"
    )

    assert response.status_code == 400
    membership.refresh_from_db()
    assert membership.rolle == Mitgliedschaft.Rolle.ADMIN


@pytest.mark.django_db
def test_membership_handle_flips_across_attach_then_detach(
    auth_client, scientist, gap_seat, organization
):
    """The seat's ``handle`` in the members list tracks its account's Beringer
    live: it is ``null`` while the seat has no Scientist, flips to the Beringer's
    Kürzel when an Admin attaches one (PRD #205, issue #209), and back to ``null``
    when the Beringer is detached — ``MitgliedschaftSerializer.handle`` reads the
    OneToOne, so it never needs its own write."""
    beringer = Scientist.objects.create(
        handle="NOH", first_name="Nina", last_name="Ohnekonto", organization=organization
    )

    def seat_handle():
        response = auth_client.get(LIST_URL)
        row = next(r for r in response.json()["results"] if r["username"] == "gap")
        return row["handle"]

    assert seat_handle() is None

    attach = auth_client.patch(
        f"/api/birds/scientists/{beringer.id}/",
        {"mitgliedschaft_id": str(gap_seat.id)},
        format="json",
    )
    assert attach.status_code == 200, attach.json()
    assert seat_handle() == "NOH"

    detach = auth_client.patch(
        f"/api/birds/scientists/{beringer.id}/",
        {"mitgliedschaft_id": None},
        format="json",
    )
    assert detach.status_code == 200, detach.json()
    assert seat_handle() is None


@pytest.mark.django_db
def test_admin_cannot_manage_another_tenants_membership(auth_client, scientist, scientist_b):
    """A cross-tenant membership is absent from the Admin's scope — a 404, not a
    403 (mirrors the rest of the tenant-scoped API)."""
    foreign = Mitgliedschaft.objects.get(user=scientist_b.user)

    patched = auth_client.patch(
        _detail_url(foreign), {"rolle": Mitgliedschaft.Rolle.MITGLIED}, format="json"
    )
    deleted = auth_client.delete(_detail_url(foreign))

    assert patched.status_code == 404
    assert deleted.status_code == 404
    assert Mitgliedschaft.objects.filter(pk=foreign.pk).exists()
