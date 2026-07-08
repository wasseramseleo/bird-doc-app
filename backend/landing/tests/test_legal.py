"""Legal & trust pages on the public Landing app (issue #78).

The Impressum, Datenschutzerklärung and AGB (with its DPA addendum) are
server-rendered Landing-app pages reached by an ordinary, unauthenticated
visitor through the Django test client — no DRF, no SPA, no login. The texts
are finalized (the former "Entwurf" draft banner is gone): the Impressum
identifies the operator (Alpine Coders e.U.), and the Datenschutzerklärung's
"keine Drittanbieter" claim is enforced here against the rendered pages.
"""

from django.urls import reverse

LEGAL_PAGES = ["impressum", "datenschutz", "agb"]

# The finalized texts carry no draft banner and no unfilled placeholders.
FORMER_DRAFT_MARKERS = ["Entwurf", "[PLATZHALTER"]


def test_legal_pages_are_finalized_without_draft_markers(client):
    for name in LEGAL_PAGES:
        content = client.get(reverse(f"landing:{name}")).content.decode()
        for marker in FORMER_DRAFT_MARKERS:
            assert marker not in content, f"{name} still carries draft marker {marker!r}"
        # Each page states its version date.
        assert "Stand:" in content


def test_impressum_identifies_the_operator(client):
    content = client.get(reverse("landing:impressum")).content.decode()
    # § 5 ECG / § 14 UGB: Firma, Inhaber, Sitz, Firmenbuchnummer + Gericht...
    assert "Alpine Coders e.U." in content
    assert "Leonard Guelmino" in content
    assert "Korneuburg" in content
    assert "FN 662283x" in content
    assert "Landesgericht Korneuburg" in content
    # ...and a reachable electronic contact address.
    assert "contact@birddoc.eu" in content
    # Kleinunternehmer statement replaces a UID.
    assert "Kleinunternehmer" in content


def test_impressum_renders_on_the_shared_public_base(client):
    response = client.get(reverse("landing:impressum"))
    assert response.status_code == 200
    # Server-rendered on the shared public base, not the Angular SPA shell.
    template_names = {t.name for t in response.templates}
    assert "landing/base.html" in template_names
    assert "app-root" not in response.content.decode()


def test_datenschutz_names_its_sub_processors(client):
    content = client.get(reverse("landing:datenschutz")).content.decode()
    # The two sub-processors are disclosed by name (issue #78): IPAX (hosting in
    # Austria) and Brevo (transactional email)...
    assert "IPAX" in content
    assert "Brevo" in content
    # ...and named as what they are — Auftragsverarbeiter (processors).
    assert "Auftragsverarbeiter" in content


def test_datenschutz_states_retention_periods(client):
    content = client.get(reverse("landing:datenschutz")).content.decode()
    # Art. 5 DSGVO (Speicherbegrenzung): server logs expire after 30 days
    # (enforced by the Caddyfile's roll_keep_for) and Warteliste/Gespräch
    # leads after 12 months at the latest.
    assert "30 Tage" in content
    assert "12 Monate" in content


# Every public page, exercised as one privacy guarantee.
PUBLIC_PAGES = ["home", "impressum", "datenschutz", "agb"]
# Third-party hosts/services we must never load (issue #78: "no third-party
# tracking cookies, so no consent banner is needed"). The Google-Fonts hosts
# are on the list because the fonts are self-hosted (ADR 0025) — the
# Datenschutzerklärung's "keine Dienste von Drittanbietern" claim depends on
# no request ever leaving for a third-party host.
THIRD_PARTY_TRACKERS = [
    "google-analytics.com",
    "googletagmanager.com",
    "gtag(",
    "matomo",
    "connect.facebook.net",
    "hotjar",
    "doubleclick",
    "fonts.googleapis.com",
    "fonts.gstatic.com",
]


def test_public_pages_set_no_cookies_on_a_plain_visit(client):
    # A plain GET of any public page sets no cookies at all — no tracking cookie,
    # so no consent banner is needed (issue #78).
    for name in PUBLIC_PAGES:
        response = client.get(reverse(f"landing:{name}"))
        assert response.status_code == 200
        assert not response.cookies, f"{name} unexpectedly set cookies: {response.cookies}"


def test_public_pages_load_no_third_party_resources(client):
    for name in PUBLIC_PAGES:
        content = client.get(reverse(f"landing:{name}")).content.decode()
        for tracker in THIRD_PARTY_TRACKERS:
            assert tracker not in content, f"{name} loads a third-party resource: {tracker}"


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
    # ...assigning the DSGVO roles: the Träger of the Organisation is the
    # controller (Verantwortlicher), BirdDoc's Betreiber is the processor
    # (Auftragsverarbeiter) — see ADR 0024.
    assert "Träger" in content
    assert "Verantwortliche" in content
    assert "Auftragsverarbeiter" in content


def test_agb_carry_the_liability_termination_and_change_clauses(client):
    content = client.get(reverse("landing:agb")).content.decode()
    # §4: KSchG-safe liability limitation (unlimited only for Vorsatz/grobe
    # Fahrlässigkeit and personal injury).
    assert "grober Fahrlässigkeit" in content
    # §5: 30-day shutdown notice with an export window.
    assert "30 Tage" in content
    # §6: the AGB change mechanism (announced by email, right to terminate).
    assert "Änderungen dieser AGB" in content


def test_datenschutz_renders_on_the_shared_public_base(client):
    response = client.get(reverse("landing:datenschutz"))
    assert response.status_code == 200
    template_names = {t.name for t in response.templates}
    assert "landing/base.html" in template_names
    assert "app-root" not in response.content.decode()


# The two most-read legal pages adopt the homepage's wider measure so they read
# at the same width/formatting as the marketing home rather than in the narrow
# form column (issue #116). The `page--marketing` body class is what carries the
# wider `--measure` on the shared header/main/footer.
def test_datenschutz_and_impressum_render_at_the_marketing_width(client):
    for slug in ("datenschutz", "impressum"):
        content = client.get(reverse(f"landing:{slug}")).content.decode()
        assert "page--marketing" in content, f"{slug} did not adopt the marketing width"
