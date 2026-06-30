"""The reduced header on the auth + legal *destination* pages (issue #102).

The public landing's auth/token flows (registration, email-verify,
password-reset, invite-accept) and legal pages (Impressum, Datenschutz, AGB) are
destinations rather than the marketing surface, so they wear a *reduced* header —
the wordmark plus a "back" affordance to the marketing home — instead of the
full marketing nav. The marketing home itself keeps the bare wordmark (its full
nav lands in a later slice). Exercised through the Django test client as an
ordinary unauthenticated visitor.
"""

import re

import pytest
from django.urls import reverse

from birds.models import Mitgliedschaft, Organization, OrgEinladung

# Just the chrome: the <header>…</header> region of a rendered page.
HEADER = re.compile(r"<header\b.*?</header>", re.DOTALL)


def _header(client, url):
    match = HEADER.search(client.get(url).content.decode())
    assert match, f"{url} rendered no <header>"
    return match.group(0)


def test_registration_header_links_back_to_the_marketing_home(client, db):
    # The tracer: a destination page's header carries a back link to the
    # marketing home, distinct from the bare wordmark.
    header = _header(client, reverse("landing:register"))
    assert "site-header__back" in header
    assert reverse("landing:home") in header


# Every auth/token-flow and legal destination reachable by a plain GET — each
# step of registration, email-verify, password-reset and the legal pages. The
# token-bearing steps are hit with a deliberately invalid link so they render
# their "this link is invalid" branch on the very same destination chrome.
DESTINATION_PAGES = [
    reverse("landing:register"),
    reverse("landing:register_done"),
    reverse("landing:register_verify", kwargs={"uidb64": "bad", "token": "bad-token"}),
    reverse("landing:password_reset"),
    reverse("landing:password_reset_done"),
    reverse("landing:password_reset_confirm", kwargs={"uidb64": "bad", "token": "bad-token"}),
    reverse("landing:password_reset_complete"),
    reverse("landing:impressum"),
    reverse("landing:datenschutz"),
    reverse("landing:agb"),
]


@pytest.mark.parametrize("url", DESTINATION_PAGES)
def test_destination_pages_wear_the_reduced_header(client, db, url):
    # Each destination wears the reduced header: the wordmark plus a back link
    # to the marketing home.
    header = _header(client, url)
    assert "site-header__back" in header, f"{url} has no reduced-header back link"
    assert reverse("landing:home") in header


# The marketing surface — the home and the Warteliste lead form — keeps the bare
# wordmark (its full nav arrives in a later slice); it must NOT show the
# destination back affordance.
MARKETING_PAGES = [
    reverse("landing:home"),
    reverse("landing:warteliste"),
    reverse("landing:warteliste_done"),
]


@pytest.mark.parametrize("url", MARKETING_PAGES)
def test_marketing_pages_keep_the_bare_wordmark(client, db, url):
    header = _header(client, url)
    assert "site-header__back" not in header, f"{url} unexpectedly shows a back link"


@pytest.mark.parametrize("url", DESTINATION_PAGES)
def test_destination_pages_do_not_leak_raw_template_comment_markup(client, db, url):
    # No template-comment syntax may reach the visitor on any public page — a
    # multi-line {# #} is not a Django comment and renders literally (the same
    # guarantee test_brand_layer asserts for the home).
    content = client.get(url).content.decode()
    assert "{#" not in content
    assert "#}" not in content


@pytest.fixture
def pending_invitation(db):
    org = Organization.objects.create(handle="ORG1", name="Test Org", country="AT")
    return OrgEinladung.objects.create(
        organization=org, email="neu@example.org", rolle=Mitgliedschaft.Rolle.MITGLIED
    )


def test_invitation_accept_wears_the_reduced_header(client, pending_invitation):
    # The invite-accept flow is a destination too — same reduced header.
    url = reverse("landing:invitation_accept", args=[pending_invitation.token])
    header = _header(client, url)
    assert "site-header__back" in header
    assert reverse("landing:home") in header


def test_invitation_accept_uses_the_unified_form_style(client, pending_invitation):
    # The one hand-rolled auth form must read like the others: its password help
    # and validation errors use the landing's shared form vocabulary
    # (`helptext` / `errorlist`, the same classes the Django `as_p` auth forms
    # emit), not the bespoke unstyled `help` / `form-errors` (issue #102).
    url = reverse("landing:invitation_accept", args=[pending_invitation.token])

    form_page = client.get(url).content.decode()
    assert "helptext" in form_page
    assert 'class="help"' not in form_page

    with_errors = client.post(
        url, {"new_password1": "willkommen-im-team-9", "new_password2": "anders-stark-2"}
    ).content.decode()
    assert "errorlist" in with_errors
    assert "form-errors" not in with_errors


def test_invitation_accept_does_not_leak_raw_template_comment_markup(client, pending_invitation):
    # The invite-accept page is re-skinned too; no template-comment syntax may
    # reach the visitor (it carried a multi-line {# #} that renders literally).
    content = client.get(
        reverse("landing:invitation_accept", args=[pending_invitation.token])
    ).content.decode()
    assert "{#" not in content
    assert "#}" not in content
