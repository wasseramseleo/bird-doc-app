"""The landing *consumes* the shared brand layer (issue #101, ADR 0009).

The byte-identical guard lives in ``test_brand_parity.py``; these tests assert
the landing actually renders from the shared layer — it links the canonical
tokens, loads Lora + Inter the way the app does, wears the real logo instead of
the old CSS-drawn ``○``, and sits on the app's warm cream paper rather than its
former grey-green.
"""


def test_landing_links_the_shared_brand_tokens(client):
    content = client.get("/").content.decode()
    # The canonical --bd-* palette + type families, shipped in the landing's own
    # static and linked on every public page via base.html.
    assert "brand-tokens.css" in content
    assert 'rel="stylesheet"' in content


def test_landing_does_not_leak_raw_template_comment_markup(client):
    # A multi-line {# #} comment is not a Django comment — it renders literally.
    # No template-comment syntax may reach the visitor.
    content = client.get("/").content.decode()
    assert "{#" not in content
    assert "#}" not in content


def test_landing_loads_lora_and_inter_the_way_the_app_does(client):
    content = client.get("/").content.decode()
    # Same Google Fonts css2 request the Angular app issues in its index.html:
    # Lora (display) + Inter (body).
    assert "fonts.googleapis.com/css2" in content
    assert "Lora" in content
    assert "Inter" in content


def test_landing_header_wears_the_real_logo_not_a_css_ring(client):
    content = client.get("/").content.decode()
    # The real BirdDoc logo, shipped as an <img>, replaces the old CSS-drawn ○.
    assert "birddoc-logo" in content
    assert "<img" in content
    # The reinvented CSS wordmark ring is gone from the chrome.
    assert "wordmark__ring" not in content


def test_landing_logo_is_an_optimized_asset(settings):
    from pathlib import Path

    logo = Path(settings.BASE_DIR) / "landing" / "static" / "landing" / "birddoc-logo.png"
    assert logo.is_file(), f"landing logo missing at {logo}"
    size = logo.stat().st_size
    # Far below the ~669 KB favicon.svg the issue calls out as too heavy for a
    # landing — a header mark needs only a small raster.
    assert size < 50_000, f"landing logo is {size} bytes — optimize it further"


def test_landing_css_sits_on_warm_cream_not_the_old_grey_green(settings):
    from pathlib import Path

    css = (Path(settings.BASE_DIR) / "landing" / "static" / "landing" / "landing.css").read_text()
    # The reinvented cool grey-green paper and the system sans-serif are gone...
    assert "#f1f3ef" not in css.lower()
    assert "-apple-system" not in css
    # ...the landing now consumes the canonical warm-cream brand tokens instead.
    assert "var(--bd-paper)" in css
