"""The landing *consumes* the shared brand layer (issue #101, ADR 0009).

The byte-identical guard lives in ``test_brand_parity.py``; these tests assert
the landing actually renders from the shared layer — it links the canonical
tokens, loads Lora + Inter the way the app does, wears the real logo instead of
the old CSS-drawn ``○``, and sits on the app's warm cream paper rather than its
former grey-green.
"""

import re


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


# ── Die Musterfläche auf dem Tinte-Band (issue #516, ADR 0043) ───────────────
#
# Die Musterfläche ist Textur, nie Illustration: sie zeichnet `fluffy`, nicht
# die gewählte Marke `fluffyfat`, und säße groß gesetzt als nicht-kanonischer
# Vogel in derselben Ansicht wie die Marke. Geprüft wird sie als CSS-Inhalt,
# wie alles andere Gestalterische in diesem Verzeichnis; die Sichtprüfung ist
# in ADR 0043 bewusst ausgelassen, weil es hier keine Apparatur dafür gibt.

MUSTER_SELEKTOR = ".page--home .band--ink::before"


def _landing_css(settings):
    from pathlib import Path

    return (Path(settings.BASE_DIR) / "landing" / "static" / "landing" / "landing.css").read_text()


def _ohne_kommentare(css):
    """``css`` mit ausgeblendeten ``/* … */`` — längentreu, damit jede Fundstelle
    weiterhin auf dieselbe Stelle im Original zeigt.

    Die Kommentare dieses Stylesheets sprechen *über* die Regel, die sie
    einleiten, und nennen sie dabei beim Namen: über dem echten At-Rule steht
    das Wort ``@supports`` schon in der Prosa. Wer den Text roh absucht, findet
    den Kommentar statt der Regel — und hielte den Schmuck für geschützt, auch
    wenn der Rahmen fehlt.
    """
    return re.sub(r"/\*.*?\*/", lambda treffer: " " * len(treffer.group()), css, flags=re.S)


def _musterflaeche_regel(css):
    """Der eine Block, der die Musterfläche auf das Tinte-Band legt."""
    prosafrei = _ohne_kommentare(css)
    assert MUSTER_SELEKTOR in prosafrei, f"kein Regelblock für {MUSTER_SELEKTOR} in landing.css"
    anfang = prosafrei.index(MUSTER_SELEKTOR)
    return css[anfang : prosafrei.index("}", anfang) + 1]


def _supports_rahmen(css):
    """Jeder @supports-Block als (Bedingung, Anfang, Ende) über Klammertiefe.

    Anfang und Ende zeigen auf ``css`` selbst; gesucht wird auf dem Text ohne
    Kommentare, damit Prosa kein At-Rule vortäuschen kann.
    """
    prosafrei = _ohne_kommentare(css)
    for treffer in re.finditer(r"@supports([^{]*)\{", prosafrei):
        tiefe = 0
        for stelle in range(treffer.end() - 1, len(prosafrei)):
            if prosafrei[stelle] == "{":
                tiefe += 1
            elif prosafrei[stelle] == "}":
                tiefe -= 1
                if tiefe == 0:
                    yield treffer.group(1), treffer.start(), stelle
                    break


def test_das_tinte_band_traegt_die_musterflaeche_in_papierfarbe(settings):
    regel = _musterflaeche_regel(_landing_css(settings))
    # Der gelieferte Kanon ist weiß und transparent und wird über `mask-image`
    # eingefärbt, statt als zweite, eingefärbte Kopie geführt zu werden — beide
    # Schreibweisen, damit auch älteres WebKit die Textur bekommt.
    assert 'mask-image: url("birddoc-muster.svg")' in regel
    assert '-webkit-mask-image: url("birddoc-muster.svg")' in regel
    # Auf dem einen dunkel invertierten Band malt die Maske Papier auf Tusche.
    assert "background-color: var(--bd-paper)" in regel


def test_die_musterflaeche_bleibt_textur_und_wird_nie_zum_motiv(settings):
    regel = _musterflaeche_regel(_landing_css(settings))
    # Sie kachelt in ihrer Token-Größe, statt eine einzelne Zeichnung auf die
    # Bandfläche zu ziehen: die Musterfläche zeichnet `fluffy`, nicht die
    # gewählte Marke — groß gesetzt säße dort ein nicht-kanonischer Vogel.
    assert "mask-repeat: repeat" in regel
    assert "-webkit-mask-repeat: repeat" in regel
    assert "mask-size: var(--bd-muster-kachel) auto" in regel
    assert "-webkit-mask-size: var(--bd-muster-kachel) auto" in regel
    for aufblasend in ("cover", "contain", "100%"):
        assert aufblasend not in regel, f"mask-size {aufblasend} macht aus der Textur ein Motiv"


def test_deckkraft_und_kachelgroesse_stehen_nirgends_als_zahl(settings):
    css = _landing_css(settings)
    assert "opacity: var(--bd-muster-deckkraft)" in _musterflaeche_regel(css)
    # Die beiden Knöpfe der Textur stehen in brand-tokens.css und laufen damit
    # unter der Parität der Markenebene. Wiederholte Zahlen laufen beim ersten
    # Nachjustieren auseinander — also darf keine der beiden hier stehen.
    assert "420px" not in css
    assert re.search(r"opacity:\s*0?\.\d", css) is None


def test_der_supports_rahmen_zaehlt_regeln_und_keine_kommentarprosa():
    # Die Wacht des nächsten Tests an einem Stylesheet, dessen Ausgang bekannt
    # ist. Der Kommentar nennt beide Wörter, nach denen sie sucht — zählte sie
    # Prosa mit, bliebe sie grün, während die Fläche ungeschützt ausliefert.
    prosa = "/* Der @supports-Rahmen auf `mask-image` ist der Ausfallmodus. */\n"
    regel = f'{MUSTER_SELEKTOR} {{ content: ""; }}\n'
    assert list(_supports_rahmen(prosa + regel)) == [], "der Kommentar gilt als Rahmen"
    # Und der echte Rahmen wird gefunden — an der Stelle, an der er steht.
    geschuetzt = prosa + '@supports (mask-image: url("x.svg")) {\n' + regel + "}\n"
    rahmen = list(_supports_rahmen(geschuetzt))
    assert len(rahmen) == 1
    bedingung, anfang, ende = rahmen[0]
    assert "mask-image" in bedingung
    assert anfang < geschuetzt.index(MUSTER_SELEKTOR) < ende


def test_ohne_maskenunterstuetzung_malt_die_musterflaeche_nicht(settings):
    css = _ohne_kommentare(_landing_css(settings))
    # Schmuck darf nie zum Defekt werden: ohne Maskenunterstützung bliebe von
    # der Regel eine flächige helle Fläche über dem Band übrig. Der ganze
    # Regelblock — samt `content` — steht deshalb hinter einem @supports-Rahmen
    # auf `mask-image`; fehlt der Rückhalt, entsteht das Pseudo-Element nicht.
    assert css.count(MUSTER_SELEKTOR) == 1, "die Musterfläche wird an mehr als einer Stelle gemalt"
    stelle = css.index(MUSTER_SELEKTOR)
    umschliessend = [
        bedingung for bedingung, anfang, ende in _supports_rahmen(css) if anfang < stelle < ende
    ]
    assert umschliessend, f"{MUSTER_SELEKTOR} steht ungeschützt außerhalb jedes @supports"
    assert any("mask-image" in bedingung for bedingung in umschliessend)


def test_die_musterflaeche_ist_schmueckend_und_wird_nicht_vorgelesen(client, settings):
    # Sie lebt als Pseudo-Element im Stylesheet, nicht als Element im Dokument:
    # die Startseite benennt sie an keiner Stelle, es gibt also nichts, was ein
    # Bildschirmleser ansagen könnte...
    assert "birddoc-muster" not in client.get("/").content.decode()
    # ...und das Pseudo-Element trägt keinen Ersatztext (`content: "" / "…"`
    # würde vorgelesen), sondern eine leere Zeichenkette.
    assert 'content: "";' in _musterflaeche_regel(_landing_css(settings))
