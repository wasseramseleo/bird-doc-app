"""The brand-layer parity guard (issue #101, ADR 0009; erweitert in #511/ADR 0043).

The brand tokens (`--bd-*` palette + the Lora/Inter font-family declarations)
have one canonical source — `frontend/src/brand-tokens.css`, consumed by the
Angular app. The Django landing ships a *copy* in its own static assets because
the app and landing are separate build roots on separate subdomains and the CDN
is gone (ADR 0007), so the share is source-time, not a runtime link.

Seit #511 gilt dieselbe Disziplin für die drei SVG-Kanons der gezeichneten
Marke (`frontend/public/birddoc-{marke,glyph,muster}.svg`), seit #512 auch für
die drei Icon-Ableitungen, die die Landing an ihrer eigenen Wurzel ausliefert
(`favicon.ico`, `favicon-96x96.png`, `apple-touch-icon.png`). ADR 0043 weitet
ADR 0009 genau deshalb aus: die Bilder liefen nie unter dieser Wacht, und genau
dort ist die Drift dann auch eingetreten — die Landing hinkte der App um eine
ganze Logo-Generation hinterher, ohne dass es jemandem aufgefallen wäre.

Verglichen werden **Bytes zwischen den Wurzeln**, nicht eine Neuerzeugung gegen
die eingecheckte Datei: ImageMagick-Versionen driften, und ein solcher Test wäre
flatterig.

These tests are the structural guard ADR 0009 exists to enforce: if the two
files ever drift apart, the build must fail. They run in CI's backend-test job,
which checks out the whole repo, so both files are on disk.
"""

from pathlib import Path

import pytest

# backend/landing/tests/test_brand_parity.py → repo root is four parents up.
REPO_ROOT = Path(__file__).resolve().parents[3]
LANDING_STATIC = REPO_ROOT / "backend" / "landing" / "static" / "landing"

# Die doppelt geführten Dateien der Markenebene: was in der App-Wurzel liegt,
# liegt byte-gleich in den Statics der Landing.
DOPPELT_GEFUEHRT = [
    (REPO_ROOT / "frontend" / "src" / "brand-tokens.css", LANDING_STATIC / "brand-tokens.css"),
    (
        REPO_ROOT / "frontend" / "public" / "birddoc-marke.svg",
        LANDING_STATIC / "birddoc-marke.svg",
    ),
    (
        REPO_ROOT / "frontend" / "public" / "birddoc-glyph.svg",
        LANDING_STATIC / "birddoc-glyph.svg",
    ),
    (
        REPO_ROOT / "frontend" / "public" / "birddoc-muster.svg",
        LANDING_STATIC / "birddoc-muster.svg",
    ),
    # Die drei Ableitungen, die die Landing selbst ausliefert (`seo.py` reicht
    # sie am Apex-Wurzelpfad heraus). Sie entstehen aus demselben Skript wie die
    # der App-Wurzel und werden darum auch byte-gleich geführt.
    (
        REPO_ROOT / "frontend" / "public" / "favicon.ico",
        LANDING_STATIC / "favicon.ico",
    ),
    (
        REPO_ROOT / "frontend" / "public" / "favicon-96x96.png",
        LANDING_STATIC / "favicon-96x96.png",
    ),
    (
        REPO_ROOT / "frontend" / "public" / "apple-touch-icon.png",
        LANDING_STATIC / "apple-touch-icon.png",
    ),
]

PARITAETSPAARE = pytest.mark.parametrize(
    ("canonical", "landing_copy"),
    DOPPELT_GEFUEHRT,
    ids=[canonical.name for canonical, _ in DOPPELT_GEFUEHRT],
)


@PARITAETSPAARE
def test_canonical_brand_asset_exists(canonical, landing_copy):
    assert canonical.is_file(), f"canonical brand asset missing at {canonical}"


@PARITAETSPAARE
def test_landing_ships_a_copy_of_every_brand_asset(canonical, landing_copy):
    assert landing_copy.is_file(), f"landing copy missing at {landing_copy}"


@PARITAETSPAARE
def test_landing_copy_is_byte_identical_to_the_canonical_source(canonical, landing_copy):
    # The whole point of the layer: the landing renders from the *same* tokens as
    # the app. Compare raw bytes so any drift — a re-tuned colour, a changed
    # font fallback, a stray whitespace edit to one file only — fails the build.
    assert landing_copy.read_bytes() == canonical.read_bytes(), (
        f"{landing_copy.relative_to(REPO_ROOT)} has drifted from the canonical "
        f"{canonical.relative_to(REPO_ROOT)} — re-copy the canonical file (ADR 0009/0043)."
    )
