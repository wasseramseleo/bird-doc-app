"""Accepting an Org-Einladung on the public Landing (issue #83).

The accept flow is server-rendered on the public Landing — reached by an
ordinary, unauthenticated visitor through the Django test client, no SPA, no
prior login. Accepting creates the account (if new) and the Mitgliedschaft, after
which the invitee can record captures as a Mitglied.
"""

import pytest
from django.contrib.auth.models import User
from django.urls import reverse
from rest_framework.test import APIClient

from birds.accounts import create_public_account
from birds.models import (
    Mitgliedschaft,
    Organization,
    OrgEinladung,
    Ring,
    RingingStation,
    Scientist,
    Species,
)

NEW_PASSWORD = "willkommen-im-team-9"
DATA_ENTRIES_URL = "/api/birds/data-entries/"


@pytest.fixture
def organization(db):
    return Organization.objects.create(handle="ORG1", name="Test Org", country="AT")


@pytest.fixture
def invitation(organization):
    return OrgEinladung.objects.create(
        organization=organization,
        email="neu@example.org",
        rolle=Mitgliedschaft.Rolle.MITGLIED,
    )


def _accept_url(invitation):
    return reverse("landing:invitation_accept", args=[invitation.token])


@pytest.mark.django_db
def test_accept_page_renders_unauthenticated_on_the_landing(client, invitation):
    response = client.get(_accept_url(invitation))

    assert response.status_code == 200
    template_names = {t.name for t in response.templates}
    assert "landing/base.html" in template_names
    content = response.content.decode()
    # Server-rendered, not the Angular SPA shell, and it names the Organisation.
    assert "app-root" not in content
    assert "Test Org" in content


@pytest.mark.django_db
def test_accepting_creates_account_and_membership(client, invitation, organization):
    """A brand-new invitee sets a password; accepting creates the account + the
    Mitgliedschaft and stamps the invite accepted."""
    response = client.post(
        _accept_url(invitation),
        {"new_password1": NEW_PASSWORD, "new_password2": NEW_PASSWORD},
    )

    assert response.status_code == 200
    user = User.objects.get(username="neu@example.org")
    assert Mitgliedschaft.objects.filter(user=user, organization=organization).exists()
    invitation.refresh_from_db()
    assert invitation.accepted_at is not None


@pytest.mark.django_db
def test_invitee_can_record_captures_after_accepting(client, invitation, organization):
    """The whole point: once accepted, the invitee logs in and records a capture
    in their new Organisation."""
    # A Station, Species and Beringer the invitee can record against.
    station = RingingStation.objects.create(
        handle="STN1", name="Station", organization=organization
    )
    species = Species.objects.create(
        common_name_de="Testvogel",
        common_name_en="Test Bird",
        scientific_name="Testus testus",
        family_name="Testidae",
        order_name="Testiformes",
        ring_size=Ring.RingSizes.V,
    )
    beringer = Scientist.objects.create(
        first_name="Hilfs", last_name="Beringer", handle="HBE", organization=organization
    )

    client.post(
        _accept_url(invitation),
        {"new_password1": NEW_PASSWORD, "new_password2": NEW_PASSWORD},
    )

    api = APIClient()
    assert api.login(username="neu@example.org", password=NEW_PASSWORD)
    response = api.post(
        DATA_ENTRIES_URL,
        {
            "species_id": str(species.id),
            "staff_id": beringer.id,
            "ringing_station_id": station.handle,
            "ring_number": "200",
            "ring_size": "V",
            "date_time": "2026-03-01T12:00:00Z",
        },
        format="json",
    )

    assert response.status_code == 201, response.json()


@pytest.mark.django_db
def test_accepting_with_existing_account_adds_membership_without_new_account(client, organization):
    """An invitee who already has an account just gains the Mitgliedschaft — no
    new account, no password needed (they keep their own credentials)."""
    existing = create_public_account("schon@example.org", "altes-passwort-stark-1")
    invitation = OrgEinladung.objects.create(organization=organization, email="schon@example.org")
    accounts_before = User.objects.count()

    # The accept page offers a one-click join, not a set-password form.
    page = client.get(_accept_url(invitation)).content.decode()
    assert "new_password1" not in page

    response = client.post(_accept_url(invitation), {})

    assert response.status_code == 200
    assert User.objects.count() == accounts_before
    assert Mitgliedschaft.objects.filter(user=existing, organization=organization).exists()


@pytest.mark.django_db
def test_password_mismatch_is_rejected_and_creates_no_account(client, invitation):
    response = client.post(
        _accept_url(invitation),
        {"new_password1": NEW_PASSWORD, "new_password2": "etwas-anderes-stark-2"},
    )

    assert response.status_code == 200  # re-renders the form with errors
    assert not User.objects.filter(username="neu@example.org").exists()
    assert not Mitgliedschaft.objects.filter(organization=invitation.organization).exists()
    invitation.refresh_from_db()
    assert invitation.accepted_at is None


@pytest.mark.django_db
def test_weak_password_is_rejected_in_german(client, invitation):
    response = client.post(
        _accept_url(invitation),
        {"new_password1": "123", "new_password2": "123"},
    )

    assert response.status_code == 200
    assert not User.objects.filter(username="neu@example.org").exists()
    # Django's validator messages render under the German catalog, not English.
    content = response.content.decode()
    assert "too short" not in content


@pytest.mark.django_db
def test_unknown_token_shows_an_invalid_page(client, db):
    response = client.get(reverse("landing:invitation_accept", args=["does-not-exist"]))

    assert response.status_code == 404
    assert "ungültig" in response.content.decode()


@pytest.mark.django_db
def test_already_accepted_token_cannot_be_reused(client, invitation, organization):
    client.post(
        _accept_url(invitation),
        {"new_password1": NEW_PASSWORD, "new_password2": NEW_PASSWORD},
    )
    # A second visit to the same link is no longer valid.
    second = client.get(_accept_url(invitation))

    assert second.status_code == 404
    assert Mitgliedschaft.objects.filter(organization=organization).count() == 1
