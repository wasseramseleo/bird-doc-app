"""Die Rasterableitungen der Marke (#512, ADR 0043).

``scripts/build-brand-assets.sh`` erzeugt aus den beiden SVG-Kanons jede
ausgelieferte PNG und jede ICO; die Ergebnisse sind eingecheckt. Geprüft wird das
**Ergebnis**, nicht der Weg dorthin — ImageMagick in der CI laufen zu lassen ist
langsam und versionsabhängig, und ein Vergleich gegen eine Neuerzeugung wäre
flatterig (so entschieden in PRD #510).

Zugesichert werden genau die Eigenschaften, an denen ein Mensch den Fehler
bemerken würde, den dieses PRD schließt:

* ``favicon.svg`` ist ein **Vektor**. Das abgelöste war 669 KB groß und trug ein
  base64-eingebettetes Pixelbild in einer SVG-Hülle — wörtlich das, was §3 des
  Briefings ausschließt.
* Die Kacheln tragen **vollflächigen Papiergrund und Safe-Kreis** und verdienen
  damit ihr ``purpose:"maskable"``. Die abgelösten waren durchsichtige Vögel
  ohne beides: Android beschneidet kreisförmig, also fielen Beine und Schnabel
  weg, auf keinen Grund.
* Die Maße stimmen. Sie werden aus dem PNG-Kopf gelesen, ohne Bildbibliothek.

Die Zahlen stehen hier ein zweites Mal — als **Zusicherung**, nicht als Quelle:
erzeugt wird jede Ableitung allein aus dem Skript.
"""

from pathlib import Path

import pytest

from landing.tests.png_bild import ecken, hat_alphakanal, masse, tuscheabstand
from landing.tests.svg_geometrie import artboard, pfaddaten

# backend/landing/tests/test_marken_ableitungen.py → die Wurzel liegt vier Ebenen höher.
REPO_ROOT = Path(__file__).resolve().parents[3]
KANON = REPO_ROOT / "frontend" / "public"

GLYPH = KANON / "birddoc-glyph.svg"
FAVICON_SVG = KANON / "favicon.svg"

# Papier (`--bd-paper`), der Grund, auf dem die Marke überall steht.
PAPIER = (0xF7, 0xF2, 0xE8)

# Die innere Safe-Zone einer maskierbaren Kachel: ein Kreis mit 80 % der
# Kantenlänge als Durchmesser (§2/A3 des Briefings). Außerhalb darf nichts
# Wichtiges liegen — das System beschneidet kreisförmig.
SAFE_ANTEIL = 0.8

# Wie viel des Safe-Kreises die Zeichnung mindestens ausfüllen muss. Ohne diese
# Untergrenze bestünde ein 20 Bildpunkte großer Vogel die Zusicherung ebenfalls.
MINDESTFUELLUNG = 0.9

RASTER_MASSE = [
    ("favicon-96x96.png", 96),
    ("apple-touch-icon.png", 180),
    ("birddoc-kachel-192.png", 192),
    ("birddoc-kachel-512.png", 512),
    ("web-app-manifest-192x192.png", 192),
    ("web-app-manifest-512x512.png", 512),
]

# Die Ableitungen, die auf einer fremden Fläche landen — Home-Screen und
# Launcher — und darum ihren eigenen Grund mitbringen müssen, statt sich auf
# eine beliebige Unterlage komponieren zu lassen.
DECKENDE_ABLEITUNGEN = [
    "apple-touch-icon.png",
    "birddoc-kachel-192.png",
    "birddoc-kachel-512.png",
    "web-app-manifest-192x192.png",
    "web-app-manifest-512x512.png",
]

KACHELN = [("birddoc-kachel-192.png", 192), ("birddoc-kachel-512.png", 512)]


def test_das_favicon_ist_ein_echter_vektor():
    assert FAVICON_SVG.is_file(), f"favicon.svg fehlt bei {FAVICON_SVG}"
    inhalt = FAVICON_SVG.read_text(encoding="utf-8")
    assert "<path" in inhalt, "favicon.svg trägt keinen einzigen Pfad"
    assert "<image" not in inhalt, "favicon.svg bettet ein Pixelbild ein"
    assert "base64" not in inhalt, "favicon.svg bettet base64-Daten ein"
    assert "data:image" not in inhalt, "favicon.svg verweist auf ein Datenbild"


def test_das_favicon_wiegt_ein_paar_kilobyte():
    # Das abgelöste favicon.svg wog 669 KB — ein Pixelbild in einer SVG-Hülle.
    groesse = FAVICON_SVG.stat().st_size
    assert groesse < 20_000, f"favicon.svg wiegt {groesse} Byte — das ist kein Vektor mehr"


def test_das_favicon_traegt_die_zeichnung_des_glyphs():
    # Rückführbar auf den Kanon: das Favicon ist das beschnittene Glyph, nicht
    # eine zweite Zeichnung, die synchron gehalten werden müsste.
    favicon = FAVICON_SVG.read_text(encoding="utf-8")
    glyph = GLYPH.read_text(encoding="utf-8")
    assert pfaddaten(favicon) == pfaddaten(glyph)
    assert artboard(favicon) == artboard(glyph)


@pytest.mark.parametrize(("datei", "kante"), RASTER_MASSE, ids=[name for name, _ in RASTER_MASSE])
def test_die_masse_stehen_im_png_kopf(datei, kante):
    # Gelesen, nicht gerendert und nicht neu erzeugt: die Maße stehen im
    # IHDR-Block der Datei.
    assert masse(KANON / datei) == (kante, kante)


@pytest.mark.parametrize("datei", DECKENDE_ABLEITUNGEN)
def test_die_deckenden_ableitungen_fuehren_keinen_alphakanal(datei):
    # Kein Alpha heißt: das System kann das Icon nicht auf einer beliebigen
    # Fläche komponieren. Genau daran krankten die abgelösten PWA-Icons.
    assert not hat_alphakanal(KANON / datei), f"{datei} ist durchsichtig"


@pytest.mark.parametrize("datei", DECKENDE_ABLEITUNGEN)
def test_der_papiergrund_reicht_bis_in_die_ecken(datei):
    # Vollflächig heißt bis in die Ecken — nicht ein Papierkreis auf Alpha.
    assert ecken(KANON / datei) == (PAPIER, PAPIER, PAPIER, PAPIER)


@pytest.mark.parametrize(("datei", "kante"), KACHELN, ids=[name for name, _ in KACHELN])
def test_die_kachel_haelt_die_zeichnung_im_safe_kreis(datei, kante):
    # Die eigentliche Zusage des `purpose:"maskable"`: was außerhalb des
    # Safe-Kreises liegt, darf das System wegschneiden. Also liegt dort nichts —
    # und der Kreis wird trotzdem ausgefüllt, sonst säße der Vogel unnötig klein
    # in einer gepolsterten Kachel.
    radius = SAFE_ANTEIL * kante / 2
    abstand = tuscheabstand(KANON / datei, PAPIER)
    assert abstand <= radius, (
        f"{datei}: die Zeichnung reicht {abstand:.1f} Bildpunkte weit, "
        f"der Safe-Kreis nur {radius:.1f} — das System schneidet sie an"
    )
    assert abstand >= MINDESTFUELLUNG * radius, (
        f"{datei}: die Zeichnung reicht nur {abstand:.1f} von {radius:.1f} "
        f"Bildpunkten weit — sie sitzt unnötig klein in der Kachel"
    )
