"""The brand-layer parity guard (issue #101, ADR 0009).

The brand tokens (`--bd-*` palette + the Lora/Inter font-family declarations)
have one canonical source — `frontend/src/brand-tokens.css`, consumed by the
Angular app. The Django landing ships a *copy* in its own static assets because
the app and landing are separate build roots on separate subdomains and the CDN
is gone (ADR 0007), so the share is source-time, not a runtime link.

These tests are the structural guard ADR 0009 exists to enforce: if the two
files ever drift apart, the build must fail. They run in CI's backend-test job,
which checks out the whole repo, so both files are on disk.
"""

from pathlib import Path

# backend/landing/tests/test_brand_parity.py → repo root is four parents up.
REPO_ROOT = Path(__file__).resolve().parents[3]
CANONICAL = REPO_ROOT / "frontend" / "src" / "brand-tokens.css"
LANDING_COPY = REPO_ROOT / "backend" / "landing" / "static" / "landing" / "brand-tokens.css"


def test_canonical_brand_tokens_exists():
    assert CANONICAL.is_file(), f"canonical brand tokens missing at {CANONICAL}"


def test_landing_ships_a_copy_of_the_brand_tokens():
    assert LANDING_COPY.is_file(), f"landing brand-tokens copy missing at {LANDING_COPY}"


def test_landing_copy_is_byte_identical_to_the_canonical_source():
    # The whole point of the layer: the landing renders from the *same* tokens as
    # the app. Compare raw bytes so any drift — a re-tuned colour, a changed
    # font fallback, a stray whitespace edit to one file only — fails the build.
    assert LANDING_COPY.read_bytes() == CANONICAL.read_bytes(), (
        "landing/static/landing/brand-tokens.css has drifted from the canonical "
        "frontend/src/brand-tokens.css — re-copy the canonical file (ADR 0009)."
    )
