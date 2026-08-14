#!/usr/bin/env bash
#
# Die Rasterableitungen der gezeichneten Marke (#512, ADR 0043).
#
# Aus den beiden SVG-Kanons — `birddoc-marke.svg` (volles Artboard, jede Fläche
# > 32 px) und `birddoc-glyph.svg` (derselbe Vogel, eng beschnitten, jede Fläche
# ≤ 32 px) — entstehen hier **elf** eingecheckte Dateien:
#
#   frontend/public/favicon.svg                      der Glyph als Vektor
#   frontend/public/favicon.ico                      16/32/48, durchsichtig
#   frontend/public/favicon-96x96.png                96, durchsichtig
#   frontend/public/apple-touch-icon.png             180, deckender Papiergrund
#   frontend/public/birddoc-kachel-192.png           maskierbar, Safe-Kreis
#   frontend/public/birddoc-kachel-512.png           maskierbar, Safe-Kreis
#   frontend/public/web-app-manifest-192x192.png     `purpose:"any"`
#   frontend/public/web-app-manifest-512x512.png     `purpose:"any"`
#   backend/landing/static/landing/favicon.ico       byte-gleiche Kopie
#   backend/landing/static/landing/favicon-96x96.png byte-gleiche Kopie
#   backend/landing/static/landing/apple-touch-icon.png byte-gleiche Kopie
#
# **Dieses Skript ist die einzige legitime Quelle jeder ausgelieferten PNG und
# jeder ICO. Eine von Hand nachbearbeitete oder anderswo exportierte Rasterdatei
# ist ein Fehler — hier ist ihr Fundort.** (Die Rasterfassungen unter
# `docs/brand/PNG/` sind Verwahrung, keine Betriebsmittel; sie kommen vom
# Künstler.) Wer eine Ableitung ändern will, ändert den Kanon oder eine Zahl in
# diesem Kopf und lässt das Skript laufen. Die
# Ergebnisse werden eingecheckt; die CI erzeugt nichts neu (ImageMagick-Versionen
# driften, ein Vergleich gegen eine Neuerzeugung wäre flatterig). Bewacht werden
# die Ergebnisse: `test_marken_ableitungen.py` (Maße, Grund, Safe-Kreis) und
# `test_brand_parity.py` (Byte-Gleichheit der doppelt geführten Dateien).
#
# Voraussetzung: ImageMagick (`convert`), getestet mit 6.9.
#
# Aufruf aus der Wurzel des Repos:  scripts/build-brand-assets.sh

set -euo pipefail

command -v convert >/dev/null || {
  echo "ImageMagick fehlt: 'convert' ist nicht im Pfad." >&2
  exit 1
}

WURZEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KANON="$WURZEL/frontend/public"
LANDING="$WURZEL/backend/landing/static/landing"

MARKE="$KANON/birddoc-marke.svg"
GLYPH="$KANON/birddoc-glyph.svg"

# ---------------------------------------------------------------------------
# Die einzige Stelle, an der eine Ableitungsgröße oder der Safe-Kreis steht.
# ---------------------------------------------------------------------------

# Papier (`--bd-paper`) — der Grund, auf dem die Marke überall steht.
PAPIER='#F7F2E8'

# Rasterdichte vor dem Verkleinern. Weit über jeder Zielgröße, damit die Kanten
# aus einer Überabtastung entstehen und nicht aus dem Zielraster.
DICHTE=1200

# Die Frames der .ico. 16 und 32 sind das Revier des Glyphs; 48 kommt dazu, weil
# `landing/base.html` genau diese drei Größen ankündigt und Windows die 48
# anfasst.
ICO_KANTEN="16 32 48"

# Der scharfe PNG-Favicon moderner Browser.
FAVICON_PNG_KANTE=96

# Das iOS-Home-Screen-Icon.
APPLE_KANTE=180

# Die beiden PWA-Kacheln — einmal maskierbar (Safe-Kreis), einmal unbeschnitten.
PWA_KANTEN="192 512"

# Die innere Safe-Zone einer maskierbaren Kachel: ein Kreis mit 80 % der
# Kantenlänge als Durchmesser (§2/A3 des Briefings). Außerhalb darf nichts
# Wichtiges liegen — Android beschneidet kreisförmig. Die Zeichnung wird also so
# skaliert, dass ihre **Diagonale** diesen Durchmesser nicht überschreitet.
SAFE_ANTEIL=0.8

# ---------------------------------------------------------------------------

erzeugt=0

melde() {
  erzeugt=$((erzeugt + 1))
  printf '  %2d  %s\n' "$erzeugt" "${1#"$WURZEL"/}"
}

svg_masz() { # <svg> <attribut> → die Zahl im ersten Vorkommen
  grep -o "$2=\"[0-9.]*\"" "$1" | head -n 1 | grep -o '[0-9.]*'
}

durchsichtig() { # <svg> <kante> <ziel>
  convert -background none -density "$DICHTE" "$1" \
    -resize "${2}x${2}" -gravity center -extent "${2}x${2}" \
    -strip "$3"
  melde "$3"
}

deckend() { # <svg> <kante> <ziel>
  convert -background none -density "$DICHTE" "$1" \
    -resize "${2}x${2}" -gravity center \
    -background "$PAPIER" -extent "${2}x${2}" -alpha remove -alpha off \
    -strip "PNG24:$3"
  melde "$3"
}

kachel() { # <kante> <ziel> — der Glyph im Safe-Kreis auf vollflächigem Papier
  local kante="$1" ziel="$2" breite hoehe
  read -r breite hoehe < <(
    awk -v k="$kante" -v anteil="$SAFE_ANTEIL" \
      -v w="$(svg_masz "$GLYPH" width)" -v h="$(svg_masz "$GLYPH" height)" \
      'BEGIN { s = anteil * k / sqrt(w * w + h * h); printf "%d %d\n", w * s, h * s }'
  )
  convert -background none -density "$DICHTE" "$GLYPH" \
    -resize "${breite}x${hoehe}" -gravity center \
    -background "$PAPIER" -extent "${kante}x${kante}" -alpha remove -alpha off \
    -strip "PNG24:$ziel"
  melde "$ziel"
}

kopiere() { # <quelle> <zielverzeichnis>
  cp "$1" "$2/"
  melde "$2/$(basename "$1")"
}

echo "Ableitungen der Marke aus $(basename "$MARKE") und $(basename "$GLYPH"):"

# 1 — Der Vektor-Favicon. Der Glyph selbst: ein paar KB statt der 669 KB, die
# das abgelöste favicon.svg als base64-Pixelbild in einer SVG-Hülle trug.
cp "$GLYPH" "$KANON/favicon.svg"
melde "$KANON/favicon.svg"

# 2 — Die .ico. Ihre Frames sind das Revier des Glyphs, durchsichtig wie der
# Vektor daneben.
frames="$(mktemp -d)"
trap 'rm -rf "$frames"' EXIT
ico_frames=()
for kante in $ICO_KANTEN; do
  convert -background none -density "$DICHTE" "$GLYPH" \
    -resize "${kante}x${kante}" -gravity center -extent "${kante}x${kante}" \
    -strip "PNG32:$frames/$kante.png"
  ico_frames+=("$frames/$kante.png")
done
convert "${ico_frames[@]}" "$KANON/favicon.ico"
melde "$KANON/favicon.ico"

# 3 — Der scharfe PNG-Favicon. Über 32 px, also die Marke mit vollem Artboard.
FAVICON_PNG="$KANON/favicon-${FAVICON_PNG_KANTE}x${FAVICON_PNG_KANTE}.png"
durchsichtig "$MARKE" "$FAVICON_PNG_KANTE" "$FAVICON_PNG"

# 4 — Das iOS-Icon. Mit deckendem Papiergrund statt Alpha, damit iOS es nicht
# auf einer beliebigen Fläche komponiert.
deckend "$MARKE" "$APPLE_KANTE" "$KANON/apple-touch-icon.png"

# 5/6 — Die maskierbaren Kacheln, gerechnet statt gezeichnet.
for kante in $PWA_KANTEN; do
  kachel "$kante" "$KANON/birddoc-kachel-$kante.png"
done

# 7/8 — Das `any`-Paar: dieselbe Marke unbeschnitten, damit ein System ohne
# Maske den Vogel nicht unnötig klein in einer gepolsterten Kachel zeigt. Auch
# hier deckender Papiergrund, aus demselben Grund wie beim iOS-Icon.
for kante in $PWA_KANTEN; do
  deckend "$MARKE" "$kante" "$KANON/web-app-manifest-${kante}x${kante}.png"
done

# 9/10/11 — Was die Landing an ihrer eigenen Wurzel ausliefert, führt sie
# byte-gleich (ADR 0009/0043, bewacht von `test_brand_parity.py`).
kopiere "$KANON/favicon.ico" "$LANDING"
kopiere "$FAVICON_PNG" "$LANDING"
kopiere "$KANON/apple-touch-icon.png" "$LANDING"

echo "$erzeugt Dateien erzeugt."
