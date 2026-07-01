"""Favicon for the marketing surface (issue #137).

The landing pages previously linked no favicon, so browsers 404ed on every
visit. The icon is derived from the existing BirdDoc brand asset, lives in the
landing's own static assets (no third-party requests) and — like `robots.txt` —
is served at the apex root with no language prefix, so every public page can
link one canonical URL (ADR 0009: the public surface is server-rendered
Django).
"""

import pytest


def test_favicon_resolves_with_the_icon_content_type(client):
    # A browser (or anything else) fetching the canonical favicon URL gets the
    # icon itself — 200, with an image/x-icon content type, no 404.
    response = client.get("/favicon.ico")
    assert response.status_code == 200
    content_type = response["Content-Type"]
    assert content_type in ("image/x-icon", "image/vnd.microsoft.icon")


@pytest.mark.parametrize(
    "url",
    [
        "/",  # marketing home
        "/en/",  # marketing home, English catalog
        "/zugang-anfragen/",  # Warteliste lead form
        "/gespraech/",  # Gespräch lead funnel
        "/registrierung/",  # Zugangscode-gated registration
        "/impressum/",  # legal surface
        "/datenschutz/",
        "/agb/",
        "/passwort-zuruecksetzen/",  # auth destination pages
    ],
)
def test_every_landing_page_links_the_favicon(client, url):
    # The shared landing base template links the favicon, so every page on the
    # marketing surface — home, lead forms, legal and auth destinations, under
    # any language prefix — tells the browser where the icon lives.
    content = client.get(url).content.decode()
    assert 'rel="icon"' in content
    assert "/favicon.ico" in content
