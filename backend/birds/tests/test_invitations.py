"""Org-Einladung: invite Mitglieder by email up to the Seat-Limit (issue #83).

An Admin grows their team inside an already-admitted Organisation by inviting a
colleague by email (ungated by the operator, capped by the Seat-Limit — ADR
0005). These exercise the invite side through the DRF API; the public accept
flow lives in ``landing/tests/test_invitation_accept.py``.
"""

import pytest

from birds.accounts import create_public_account
from birds.models import Mitgliedschaft, OrgEinladung, Scientist

INVITATIONS_URL = "/api/birds/invitations/"


@pytest.mark.django_db
def test_admin_invites_colleague_by_email_sends_mail(auth_client, scientist, mailoutbox):
    """An Admin invites a colleague by email; the invitee gets exactly one mail
    from the BirdDoc sender, and a pending Einladung is recorded."""
    response = auth_client.post(INVITATIONS_URL, {"email": "kollege@example.org"}, format="json")

    assert response.status_code == 201, response.json()
    invitation = OrgEinladung.objects.get(email="kollege@example.org")
    assert invitation.organization == scientist.organization
    assert invitation.rolle == Mitgliedschaft.Rolle.MITGLIED
    assert invitation.accepted_at is None

    assert len(mailoutbox) == 1
    message = mailoutbox[0]
    assert message.to == ["kollege@example.org"]
    assert message.from_email == "noreply@birddoc.at"
    # The mail carries the accept link the invitee follows on the public Landing.
    assert f"/einladung/{invitation.token}/" in message.body


@pytest.mark.django_db
def test_invite_email_is_normalised(auth_client, scientist):
    """The invited email is stored normalised (lowercased), matching ADR 0008."""
    auth_client.post(INVITATIONS_URL, {"email": "  Misch.Case@Example.ORG "}, format="json")

    assert OrgEinladung.objects.filter(email="misch.case@example.org").exists()


@pytest.mark.django_db
def test_plain_mitglied_cannot_invite_and_sends_no_mail(
    mitglied_client, mitglied_scientist, mailoutbox
):
    """Member management is Admin-only (issue #76): a plain Mitglied is refused
    with a clear message and no mail leaves the system."""
    response = mitglied_client.post(
        INVITATIONS_URL, {"email": "kollege@example.org"}, format="json"
    )

    assert response.status_code == 403
    assert "Administrator" in response.json()["detail"]
    assert OrgEinladung.objects.count() == 0
    assert mailoutbox == []


@pytest.mark.django_db
def test_anonymous_cannot_invite(api_client, mailoutbox):
    response = api_client.post(INVITATIONS_URL, {"email": "kollege@example.org"}, format="json")

    assert response.status_code in (401, 403)
    assert OrgEinladung.objects.count() == 0
    assert mailoutbox == []


@pytest.mark.django_db
def test_invite_blocked_once_seat_limit_reached(auth_client, user, organization, mailoutbox):
    """An invitation is blocked once the Seat-Limit is reached, with a clear
    message and no mail (ADR 0005). Here the Admin's own Mitgliedschaft already
    fills a one-seat Organisation."""
    organization.seat_limit = 1
    organization.save(update_fields=["seat_limit"])
    Mitgliedschaft.objects.create(
        user=user, organization=organization, rolle=Mitgliedschaft.Rolle.ADMIN
    )

    response = auth_client.post(INVITATIONS_URL, {"email": "kollege@example.org"}, format="json")

    assert response.status_code == 409
    assert "Seat-Limit" in response.json()["detail"]
    assert OrgEinladung.objects.count() == 0
    assert mailoutbox == []


@pytest.mark.django_db
def test_pending_invitations_count_against_the_seat_limit(auth_client, user, organization):
    """A pending Einladung reserves a Mitgliedsplatz: with a two-seat Organisation
    and the Admin filling one, exactly one invite fits and the next is blocked —
    so ten invites cannot all accept against one free seat."""
    organization.seat_limit = 2
    organization.save(update_fields=["seat_limit"])
    Mitgliedschaft.objects.create(
        user=user, organization=organization, rolle=Mitgliedschaft.Rolle.ADMIN
    )

    first = auth_client.post(INVITATIONS_URL, {"email": "one@example.org"}, format="json")
    second = auth_client.post(INVITATIONS_URL, {"email": "two@example.org"}, format="json")

    assert first.status_code == 201
    assert second.status_code == 409
    assert OrgEinladung.objects.count() == 1


@pytest.mark.django_db
def test_no_account_beringer_does_not_consume_a_seat(auth_client, user, organization, mailoutbox):
    """No-account Beringer are selectable names, not actors, and consume no
    Mitgliedsplatz: a one-seat Organisation already full of its Admin stays full
    no matter how many no-account Beringer it owns — but adding them never *uses
    up* a seat either, so a two-seat Organisation still has room to invite."""
    organization.seat_limit = 2
    organization.save(update_fields=["seat_limit"])
    Mitgliedschaft.objects.create(
        user=user, organization=organization, rolle=Mitgliedschaft.Rolle.ADMIN
    )
    # Five no-account Beringer — if they consumed seats, the org would be far over.
    for i in range(5):
        Scientist.objects.create(
            first_name=f"Helfer{i}", last_name="Feld", handle=f"NA{i}", organization=organization
        )

    response = auth_client.post(INVITATIONS_URL, {"email": "kollege@example.org"}, format="json")

    # Still room: 1 Mitgliedschaft + 0 pending = 1 < 2 seats, beringer ignored.
    assert response.status_code == 201
    assert len(mailoutbox) == 1


@pytest.mark.django_db
def test_invite_rejected_when_already_a_member(auth_client, scientist):
    """Inviting someone who is already a Mitglied of the Organisation is rejected
    with a clear message."""
    colleague = create_public_account("bekannt@example.org", "hunter2-very-strong")
    Mitgliedschaft.objects.create(
        user=colleague, organization=scientist.organization, rolle=Mitgliedschaft.Rolle.MITGLIED
    )

    response = auth_client.post(INVITATIONS_URL, {"email": "bekannt@example.org"}, format="json")

    assert response.status_code == 400
    assert "Mitglied" in str(response.json())


@pytest.mark.django_db
def test_duplicate_pending_invitation_rejected(auth_client, scientist, mailoutbox):
    """A second invitation to the same address while one is still open is rejected
    (and sends no second mail)."""
    first = auth_client.post(INVITATIONS_URL, {"email": "kollege@example.org"}, format="json")
    second = auth_client.post(INVITATIONS_URL, {"email": "kollege@example.org"}, format="json")

    assert first.status_code == 201
    assert second.status_code == 400
    assert OrgEinladung.objects.filter(email="kollege@example.org").count() == 1
    assert len(mailoutbox) == 1
