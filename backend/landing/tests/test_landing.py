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


def test_landing_page_uses_shared_base_template(client):
    # A shared public base template is in place and the landing page extends it,
    # so subsequent public pages (registration, legal, Warteliste, …) can reuse it.
    response = client.get("/")
    template_names = {t.name for t in response.templates}
    assert "landing/base.html" in template_names
    assert "landing/home.html" in template_names
