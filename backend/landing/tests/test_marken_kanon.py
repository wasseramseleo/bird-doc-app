"""Die drei SVG-Kanons der gezeichneten Marke (#511, ADR 0043).

Die Parität zwischen den beiden Wurzeln bewacht ``test_brand_parity.py``. Hier
steht, was die Kanons **sind** — die Eigenschaften, die ein Mensch bemerken
würde, wenn sie verloren gingen:

* Es sind Vektoren. Der Defekt, den dieses PRD schließt, ist ein 669 KB großes
  ``favicon.svg``, in dem ein base64-eingebettetes PNG steckt und kein einziger
  Pfad — genau das, was §3 des Briefings ausschließt.
* ``birddoc-glyph.svg`` ist derselbe Vogel wie ``birddoc-marke.svg``, nur eng
  beschnitten. Nicht nachgezeichnet, nicht vereinfacht (das wäre A2 und ist
  nicht geliefert): dieselben Pfaddaten, ein engeres Artboard.
* ``birddoc-muster.svg`` ist die Lieferung des Künstlers, unverändert, und
  kachelt weiterhin in beiden Achsen nahtlos.

Gerechnet, nicht gerendert: ``svg_geometrie`` misst den Rahmen der Tusche direkt
aus den Pfaddaten. Ein Test, der ImageMagick oder einen Browser anwirft, wäre
versionsabhängig und flatterig.
"""

from pathlib import Path

import pytest

from landing.tests.svg_geometrie import artboard, pfaddaten, tusche_rahmen

# backend/landing/tests/test_marken_kanon.py → die Wurzel liegt vier Ebenen höher.
REPO_ROOT = Path(__file__).resolve().parents[3]
KANON = REPO_ROOT / "frontend" / "public"
ORIGINALE = REPO_ROOT / "docs" / "brand" / "SVG"
MARKEN_TOKENS = REPO_ROOT / "frontend" / "src" / "brand-tokens.css"

MARKE = KANON / "birddoc-marke.svg"
GLYPH = KANON / "birddoc-glyph.svg"
MUSTER = KANON / "birddoc-muster.svg"

# Der Beschnitt und die Kachelgrenze werden auf zwei Nachkommastellen notiert;
# mehr Abweichung als eine Rundung darf zwischen Tusche und Artboard nicht
# liegen. Bezogen auf die 1888.73 Einheiten breite Musterkachel sind das 0,005 %.
RUNDUNGSSPIELRAUM = 0.05


@pytest.mark.parametrize("kanon", [MARKE, GLYPH, MUSTER], ids=lambda p: p.name)
def test_jeder_kanon_ist_ein_echter_vektor(kanon):
    assert kanon.is_file(), f"Kanon fehlt: {kanon}"
    inhalt = kanon.read_text(encoding="utf-8")
    # Echte Pfade — und kein eingebettetes Pixelbild in einer SVG-Hülle, wie es
    # das abgelöste favicon.svg war (669 KB, kein einziger <path>).
    assert "<path" in inhalt, f"{kanon.name} trägt keinen einzigen Pfad"
    assert "<image" not in inhalt, f"{kanon.name} bettet ein Pixelbild ein"
    assert "base64" not in inhalt, f"{kanon.name} bettet base64-Daten ein"
    assert "data:image" not in inhalt, f"{kanon.name} verweist auf ein Datenbild"


def test_die_marke_traegt_die_zeichnung_des_kuenstlers():
    # Der Kanon ist die gewählte Variante `fluffyfat` mit vollem Artboard —
    # rückführbar auf das verwahrte Original, nicht nachgezogen.
    original = (ORIGINALE / "birb_fluffyfat.svg").read_text(encoding="utf-8")
    assert pfaddaten(MARKE.read_text(encoding="utf-8")) == pfaddaten(original)
    assert artboard(MARKE.read_text(encoding="utf-8")) == artboard(original)


def test_das_glyph_traegt_dieselben_pfade_wie_die_marke():
    # „Mechanischer Beschnitt" heißt: kein Strich ist anders. Wäre hier
    # nachgezeichnet oder vereinfacht worden, gäbe es zwei Zeichnungen, die
    # synchron gehalten werden müssten.
    assert pfaddaten(GLYPH.read_text(encoding="utf-8")) == pfaddaten(
        MARKE.read_text(encoding="utf-8")
    )


def test_das_glyph_artboard_ist_enger_und_liegt_in_dem_der_marke():
    glyph_links, glyph_oben, glyph_rechts, glyph_unten = artboard(GLYPH.read_text(encoding="utf-8"))
    marke_links, marke_oben, marke_rechts, marke_unten = artboard(MARKE.read_text(encoding="utf-8"))
    assert glyph_links >= marke_links
    assert glyph_oben >= marke_oben
    assert glyph_rechts <= marke_rechts
    assert glyph_unten <= marke_unten
    assert glyph_rechts - glyph_links < marke_rechts - marke_links
    assert glyph_unten - glyph_oben < marke_unten - marke_oben


def test_das_glyph_artboard_umschliesst_die_tusche_knapp():
    # Das ist der eigentliche Gewinn des Beschnitts: bei gleicher Pixelgröße
    # steht mehr Tusche im Bild (rund 35 % mehr lineares Maß, ADR 0043). Der
    # Rahmen muss die Tusche also berühren — weder abschneiden noch polstern.
    inhalt = GLYPH.read_text(encoding="utf-8")
    for kante, (des_artboards, der_tusche) in enumerate(
        zip(artboard(inhalt), tusche_rahmen(inhalt), strict=True)
    ):
        assert abs(des_artboards - der_tusche) <= RUNDUNGSSPIELRAUM, (
            f"Kante {kante}: Artboard {des_artboards} gegen Tusche {der_tusche}"
        )


def test_die_musterflaeche_ist_inhaltlich_unveraendert():
    # Nicht eingefärbt, nicht zugeschnitten: die Einfärbung passiert später über
    # `mask-image`, und ein kleinerer Ausschnitt würde aus der Anordnung der 32
    # Positionen ein Raster machen (in ADR 0043 abgewogen und abgelehnt).
    assert MUSTER.read_bytes() == (ORIGINALE / "birb_pattern.svg").read_bytes()


def test_die_musterflaeche_kachelt_in_beiden_achsen_nahtlos():
    # Nahtlos heißt zweierlei, und beides ist am Rahmen der Tusche ablesbar:
    # keine Zeichnung ragt über die Kachelgrenze (sonst schnitte die
    # Wiederholung sie ab), und keine Kante bleibt leer (sonst liefe eine
    # Gasse durch die Fläche).
    inhalt = MUSTER.read_text(encoding="utf-8")
    for kante, (der_kachel, der_tusche) in enumerate(
        zip(artboard(inhalt), tusche_rahmen(inhalt), strict=True)
    ):
        assert abs(der_kachel - der_tusche) <= RUNDUNGSSPIELRAUM, (
            f"Kante {kante}: Kachelgrenze {der_kachel} gegen Tusche {der_tusche}"
        )


@pytest.mark.parametrize("token", ["--bd-muster-kachel", "--bd-muster-deckkraft"])
def test_die_muster_knoepfe_stehen_in_den_marken_tokens(token):
    # Kachelgröße und Deckkraft stehen in der Markenebene und nicht in
    # `landing.css` bzw. `login.scss`, damit „niedriger Kontrast“ ein prüfbarer
    # Wert bleibt — und damit sie unter derselben Parität laufen wie die Palette.
    css = MARKEN_TOKENS.read_text(encoding="utf-8")
    assert f"{token}:" in css, f"{token} fehlt in brand-tokens.css"
