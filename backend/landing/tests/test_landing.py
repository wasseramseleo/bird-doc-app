"""Tests for the public landing app (issue #71).

These exercise the apex landing page through the Django test client as an
ordinary, unauthenticated visitor would reach it — no DRF, no SPA, no login.
"""


def test_landing_page_returns_200(client):
    response = client.get("/")
    assert response.status_code == 200


def test_landing_page_is_public_without_authentication(client):
    # `client` is an anonymous visitor — no login, no session.
    response = client.get("/")
    # Served directly, never redirected into a login/auth flow.
    assert response.status_code == 200
    assert not (300 <= response.status_code < 400)


def test_landing_page_is_server_rendered_not_the_spa(client):
    response = client.get("/")
    assert response["Content-Type"].startswith("text/html")
    content = response.content.decode()
    # The product name and real descriptive copy are rendered server-side...
    assert "BirdDoc" in content
    assert "Beringung" in content
    # ...and this is a plain web page, not the Angular SPA shell.
    assert "app-root" not in content


def test_landing_pages_share_one_stylesheet(client):
    # Every public page extends landing/base.html, so a single linked stylesheet
    # gives the home page and the reset flow one consistent look.
    response = client.get("/")
    content = response.content.decode()
    assert 'rel="stylesheet"' in content
    assert "landing.css" in content


def test_landing_page_shows_a_beta_badge(client):
    # The hero carries a Beta badge announcing the public beta (issue #78).
    content = client.get("/").content.decode()
    assert "badge" in content
    assert "Beta" in content


def test_landing_page_shows_the_price_teaser(client):
    # The price-teaser frames the three pricing facts (issue #78): free during the
    # beta, a per-Organisation licence at 1.0, and a permanent preferential price
    # for the beta cohort.
    content = client.get("/").content.decode()
    assert "kostenlos" in content
    assert "pro Organisation" in content
    assert "1.0" in content
    assert "dauerhaft" in content
    assert "Vorzugspreis" in content


def test_landing_page_shows_the_austria_eu_hosting_statement(client):
    # Austria/EU hosting reassurance (issue #78, ADR 0007).
    content = client.get("/").content.decode()
    assert "Österreich" in content
    assert "EU" in content
    assert "gehostet" in content or "Hosting" in content


def test_landing_page_links_to_the_legal_pages(client):
    from django.urls import reverse

    content = client.get("/").content.decode()
    # The landing page links to each legal page (issue #78).
    assert reverse("landing:impressum") in content
    assert reverse("landing:datenschutz") in content
    assert reverse("landing:agb") in content


def test_home_renders_the_shared_hero_thesis(client):
    # The shared hero opens on the common truth both audiences hold (issue #104):
    # an end to paper-and-Excel documentation. A placeholder marks where the
    # credible Fang-Karte artifact + Ringserie sequence land (built in the hero
    # slice), so the hero is laid out around it here.
    content = client.get("/").content.decode()
    assert "Schluss mit Papier und Excel" in content
    assert "hero__artifact" in content


def test_home_fork_band_renders_both_audience_columns_in_the_dom(client):
    # The two-column fork band carries BOTH audience columns server-side (issue
    # #104) — SEO, and it works without JS; neither column is hidden behind a
    # tab/toggle. The org column links down to the Für-Organisationen section.
    content = client.get("/").content.decode()
    assert content.count("fork__col") >= 2
    assert "Für Beringer" in content
    assert "Für Organisationen &amp; Vogelwarten" in content
    assert "#organisationen" in content


def test_home_fuer_beringer_section_names_pain_relief_beta_and_warteliste_cta(client):
    from django.urls import reverse

    content = client.get("/").content.decode()
    # The Für-Beringer section is the anchored destination of the nav + fork band.
    assert 'id="fuer-beringer"' in content
    assert 'id="funktionen"' in content
    # It names the pain — manual documentation on paper and in Excel...
    assert "Papier" in content
    assert "Excel" in content
    # ...shows the concrete relief — a clean Fang-Karte, smart ring-numbering,
    # the IWM export...
    assert "Fang-Karte" in content
    assert "Ringnummer" in content
    assert "IWM" in content
    # ...carries the beta framing, and ends in the Warteliste CTA wired to the
    # typed lead form.
    assert "Beta" in content
    assert reverse("landing:warteliste") in content


def test_home_top_nav_carries_anchors_login_out_and_lang_slot(client, settings):
    # The marketing home wears a full top nav (issue #104): in-page anchors to
    # its IA sections, an *Anmelden* action that links OUT to the SPA login
    # (login stays in the SPA — ADR 0008, never a server-rendered form), and a
    # slot for the DE/EN toggle wired up later by the i18n slice.
    content = client.get("/").content.decode()
    assert "site-nav" in content
    assert "#funktionen" in content
    assert "#organisationen" in content
    assert "#preise" in content
    # Anmelden points at the SPA login URL, not a landing route.
    assert "Anmelden" in content
    assert settings.APP_LOGIN_URL in content
    # The DE/EN toggle slot is present for the i18n slice to upgrade.
    assert "lang-toggle" in content


def test_landing_page_uses_shared_base_template(client):
    # A shared public base template is in place and the landing page extends it,
    # so subsequent public pages (registration, legal, Warteliste, …) can reuse it.
    response = client.get("/")
    template_names = {t.name for t in response.templates}
    assert "landing/base.html" in template_names
    assert "landing/home.html" in template_names
