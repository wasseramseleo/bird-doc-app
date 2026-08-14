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
    # Lora (display) + Inter (body), self-hosted like the Angular app's bundled
    # @fontsource files (ADR 0025) — no request may leave for Google's CDN.
    assert "landing/fonts.css" in content
    assert "fonts.googleapis.com" not in content
    assert "fonts.gstatic.com" not in content


def test_landing_font_css_declares_lora_and_inter_from_local_files(settings):
    from pathlib import Path

    static = Path(settings.BASE_DIR) / "landing" / "static" / "landing"
    css = (static / "fonts.css").read_text()
    assert "font-family: 'Lora'" in css
    assert "font-family: 'Inter'" in css
    # Every referenced woff2 is actually vendored next to the stylesheet.
    for line in css.splitlines():
        if "url(./fonts/" in line:
            filename = line.split("url(./fonts/")[1].split(")")[0]
            assert (static / "fonts" / filename).is_file(), f"missing font file {filename}"


def _wortmarken_bild(content: str) -> str:
    """Das ``<img>`` der Wortmarke, so wie die Kopfleiste es tatsächlich ausliefert."""
    import re

    treffer = re.search(r"<img[^>]*wordmark__mark[^>]*>", content)
    assert treffer, "die Wortmarke der Landing trägt kein Bild"
    return treffer.group(0)


def _attribut(tag: str, name: str) -> str:
    import re

    treffer = re.search(rf'{name}="([^"]*)"', tag)
    assert treffer, f"{name} fehlt an {tag}"
    return treffer.group(1)


def test_landing_header_wears_the_real_logo_not_a_css_ring(client):
    content = client.get("/").content.decode()
    # Die gezeichnete Marke steht als <img> dort, wo früher der CSS-gemalte ○
    # stand — und bei 28 px trägt die Wortmarke den eng beschnittenen Glyph
    # (ADR 0043: bis 32 px das Glyph, darüber die volle Marke).
    bild = _wortmarken_bild(content)
    assert int(_attribut(bild, "width")) <= 32
    assert "birddoc-glyph.svg" in _attribut(bild, "src")
    # The reinvented CSS wordmark ring is gone from the chrome.
    assert "wordmark__ring" not in content


def test_landing_logo_is_an_optimized_asset(client, settings):
    from pathlib import Path

    # Die eigentlich gemeinte Zusicherung, nicht bloß eine Größenschranke: die
    # Marke der Landing ist ein **echter Vektor ohne eingebettetes Pixelbild**.
    # Der Defekt, den der frühere Kommentar hier nur als Warnung zitierte — eine
    # 669 KB schwere SVG-Hülle um ein base64-PNG —, ist damit geschlossen; §3
    # des Briefings schließt eingebettete Pixelbilder aus (ADR 0043).
    quelle = _attribut(_wortmarken_bild(client.get("/").content.decode()), "src")
    logo = Path(settings.BASE_DIR) / "landing" / "static" / quelle.split("/static/", 1)[1]
    assert logo.is_file(), f"landing logo missing at {logo}"
    assert logo.suffix == ".svg", f"die Marke der Landing ist kein Vektor: {logo.name}"
    inhalt = logo.read_text(encoding="utf-8")
    assert "<path" in inhalt, f"{logo.name} trägt keinen einzigen Pfad"
    for eingebettet in ("<image", "base64", "data:image"):
        assert eingebettet not in inhalt, f"{logo.name} bettet ein Pixelbild ein ({eingebettet})"
    size = logo.stat().st_size
    # Und damit ein paar Kilobyte statt eines halben Megabytes.
    assert size < 50_000, f"landing logo is {size} bytes — optimize it further"


def test_landing_css_sits_on_warm_cream_not_the_old_grey_green(settings):
    from pathlib import Path

    css = (Path(settings.BASE_DIR) / "landing" / "static" / "landing" / "landing.css").read_text()
    # The reinvented cool grey-green paper and the system sans-serif are gone...
    assert "#f1f3ef" not in css.lower()
    assert "-apple-system" not in css
    # ...the landing now consumes the canonical warm-cream brand tokens instead.
    assert "var(--bd-paper)" in css
