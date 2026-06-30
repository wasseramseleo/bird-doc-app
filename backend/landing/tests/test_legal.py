"""Legal & trust pages on the public Landing app (issue #78).

The Impressum, Datenschutzerklärung and AGB (with its DPA addendum) are
server-rendered Landing-app pages reached by an ordinary, unauthenticated
visitor through the Django test client — no DRF, no SPA, no login. The texts
are review-ready *drafts*, gated on human/lawyer review before go-live.
"""

from django.urls import reverse

# Every legal page carries the same visible "this is a draft" marker, since the
# texts are gated on human/lawyer review before go-live (issue #78, HITL).
DRAFT_MARKER = "Entwurf"
DRAFT_REVIEW_NOTE = "rechtlicher Prüfung"
# Operator-identifying details are deliberately unfilled placeholders.
PLACEHOLDER = "[PLATZHALTER"


def test_impressum_renders_on_the_shared_public_base(client):
    response = client.get(reverse("landing:impressum"))
    assert response.status_code == 200
    # Server-rendered on the shared public base, not the Angular SPA shell.
    template_names = {t.name for t in response.templates}
    assert "landing/base.html" in template_names
    assert "app-root" not in response.content.decode()


def test_datenschutz_names_its_sub_processors_and_is_a_draft(client):
    content = client.get(reverse("landing:datenschutz")).content.decode()
    # The two sub-processors are disclosed by name (issue #78): IPAX (hosting in
    # Austria) and Brevo (transactional email)...
    assert "IPAX" in content
    assert "Brevo" in content
    # ...and named as what they are — Auftragsverarbeiter (processors).
    assert "Auftragsverarbeiter" in content
    # Still a draft pending human/lawyer review.
    assert DRAFT_MARKER in content
    assert DRAFT_REVIEW_NOTE in content


# Every public page, exercised as one privacy guarantee.
PUBLIC_PAGES = ["home", "impressum", "datenschutz", "agb"]
# Third-party analytics / tracking services we must never load (issue #78:
# "no third-party tracking cookies, so no consent banner is needed").
THIRD_PARTY_TRACKERS = [
    "google-analytics.com",
    "googletagmanager.com",
    "gtag(",
    "matomo",
    "connect.facebook.net",
    "hotjar",
    "doubleclick",
]


def test_public_pages_set_no_cookies_on_a_plain_visit(client):
    # A plain GET of any public page sets no cookies at all — no tracking cookie,
    # so no consent banner is needed (issue #78).
    for name in PUBLIC_PAGES:
        response = client.get(reverse(f"landing:{name}"))
        assert response.status_code == 200
        assert not response.cookies, f"{name} unexpectedly set cookies: {response.cookies}"


def test_public_pages_load_no_third_party_trackers(client):
    for name in PUBLIC_PAGES:
        content = client.get(reverse(f"landing:{name}")).content.decode()
        for tracker in THIRD_PARTY_TRACKERS:
            assert tracker not in content, f"{name} loads a third-party tracker: {tracker}"


def test_agb_renders_on_the_shared_public_base(client):
    response = client.get(reverse("landing:agb"))
    assert response.status_code == 200
    template_names = {t.name for t in response.templates}
    assert "landing/base.html" in template_names
    assert "app-root" not in response.content.decode()


def test_agb_include_a_dpa_addendum_with_controller_and_processor_roles(client):
    content = client.get(reverse("landing:agb")).content.decode()
    # The AGB carry a DPA addendum (Auftragsverarbeitung) per issue #78...
    assert "Auftragsverarbeitung" in content
    # ...assigning the DSGVO roles: the Organisation is controller
    # (Verantwortliche), BirdDoc is processor (Auftragsverarbeiter).
    assert "Verantwortliche" in content
    assert "Auftragsverarbeiter" in content
    # Still a draft pending human/lawyer review.
    assert DRAFT_MARKER in content
    assert DRAFT_REVIEW_NOTE in content


def test_impressum_identifies_operator_as_einzelunternehmen_with_placeholders(client):
    content = client.get(reverse("landing:impressum")).content.decode()
    # The operator is identified as an Einzelunternehmen (issue #78)...
    assert "Einzelunternehmen" in content
    # ...but the identifying details stay clearly-marked placeholders for now.
    assert PLACEHOLDER in content
    # And the whole text is visibly a draft, pending human/lawyer review.
    assert DRAFT_MARKER in content
    assert DRAFT_REVIEW_NOTE in content


def test_datenschutz_renders_on_the_shared_public_base(client):
    response = client.get(reverse("landing:datenschutz"))
    assert response.status_code == 200
    template_names = {t.name for t in response.templates}
    assert "landing/base.html" in template_names
    assert "app-root" not in response.content.decode()
