"""Password reset on the public Landing app (issue #77).

The reset flow is Django's built-in password reset, server-rendered as
Landing-app templates and reached by an ordinary, unauthenticated visitor
through the Django test client — no DRF, no SPA, no login.
"""

import re

import pytest
from django.urls import reverse

from birds.accounts import create_public_account

# The reset link Django emails, as a server-relative path: /passwort-zuruecksetzen/<uid>/<token>/
RESET_LINK = re.compile(r"/passwort-zuruecksetzen/[\w\-]+/[\w\-]+/")


@pytest.fixture
def account(db):
    """A public account whose login identifier is its email (ADR 0008)."""
    return create_public_account("ringer@example.org", "old-pass-very-strong-1")


def test_reset_request_page_renders_unauthenticated(client):
    # An anonymous visitor reaches the "request a reset" page directly.
    response = client.get(reverse("landing:password_reset"))
    assert response.status_code == 200
    # Server-rendered on the shared public base, not the Angular SPA shell.
    template_names = {t.name for t in response.templates}
    assert "landing/base.html" in template_names
    content = response.content.decode()
    assert "app-root" not in content


def test_request_for_known_email_sends_reset_mail(client, account, mailoutbox):
    response = client.post(reverse("landing:password_reset"), {"email": "ringer@example.org"})
    # Request accepted and the visitor is sent on to the confirmation page.
    assert response.status_code == 302
    # Exactly one reset mail leaves the system, from the BirdDoc sender.
    assert len(mailoutbox) == 1
    message = mailoutbox[0]
    assert message.to == ["ringer@example.org"]
    assert message.from_email == "noreply@birddoc.eu"


def test_following_link_sets_a_new_password_the_user_can_log_in_with(client, account, mailoutbox):
    client.post(reverse("landing:password_reset"), {"email": "ringer@example.org"})
    confirm_path = RESET_LINK.search(mailoutbox[0].body).group(0)

    # Following the link lands on the set-a-new-password page (Django swaps the
    # token in the URL for one held in the session, then shows the form).
    landing = client.get(confirm_path)
    assert landing.status_code == 302
    set_password_page = client.get(landing.url)
    assert set_password_page.status_code == 200
    assert "landing/base.html" in {t.name for t in set_password_page.templates}

    new_password = "brand-new-pass-7key"
    done = client.post(
        landing.url,
        {"new_password1": new_password, "new_password2": new_password},
    )
    assert done.status_code == 302

    # The old password no longer works; the new one logs the user in.
    assert not client.login(username="ringer@example.org", password="old-pass-very-strong-1")
    assert client.login(username="ringer@example.org", password=new_password)


def test_request_for_unknown_email_reveals_nothing_and_sends_no_mail(client, db, mailoutbox):
    # An address with no account must not be distinguishable from a real one:
    # same confirmation redirect, but no mail leaves the system.
    response = client.post(reverse("landing:password_reset"), {"email": "nobody@example.org"})
    assert response.status_code == 302
    assert response.url == reverse("landing:password_reset_done")
    assert mailoutbox == []


def test_set_password_page_renders_the_auth_form_in_german(client, account, mailoutbox):
    # Django's built-in auth form (field labels, password-validator help texts,
    # error messages) is rendered in German on the public landing, not English.
    client.post(reverse("landing:password_reset"), {"email": "ringer@example.org"})
    confirm_path = RESET_LINK.search(mailoutbox[0].body).group(0)
    set_password_url = client.get(confirm_path).url
    content = client.get(set_password_url).content.decode()

    # The English defaults are gone — both the field labels...
    assert "New password" not in content
    # ...and the password-validator help text.
    assert "Your password" not in content
    # ...replaced by Django's German catalog (the confirmation field label and
    # the validator help text both come from the form, not our own templates).
    assert "Neues Passwort bestätigen" in content
    assert "Das Passwort muss mindestens 8 Zeichen enthalten." in content
