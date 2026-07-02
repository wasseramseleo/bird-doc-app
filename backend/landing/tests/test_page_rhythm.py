"""The marketing home's page rhythm — full-bleed bands (issue #142).

The long marketing page reads as one undifferentiated column when every
section sits as the same bordered card on the same cream ground. Issue #142
turns the sections into full-bleed background bands that alternate the
existing surface tokens (ADR 0009), with exactly ONE section inverted to the
dark ink ground: Für Organisationen & Vogelwarten.

These tests pin the DOM structure that carries the banding — the band
wrappers, their alternation, and the single dark band around the org section
with its Gespräch CTA. The actual visual outcome (colors, full-bleed paint)
has no automated CSS seam per the PRD: it is verified manually via Playwright
screenshots at desktop and mobile viewports during review. No CSS-value or
styling-proxy assertions live here.
"""

import re

# The band wrappers proper (`band band--<surface>`), not the .band__inner
# content column each one re-centres on the measure.
BAND_OPEN = re.compile(r'<div class="(band band--[a-z]+)">')


def test_home_sections_render_inside_alternating_band_wrappers(client):
    # The marketing home's sections sit inside full-bleed band wrappers, and
    # adjacent bands never share the same surface — that alternation IS the
    # scroll rhythm the issue asks for.
    content = client.get("/").content.decode()
    bands = BAND_OPEN.findall(content)
    # Enough bands to give the long scroll a rhythm (hero, Beringer, proof,
    # comparison, org, closing) — not one monolithic wrapper.
    assert len(bands) >= 5, f"expected >= 5 bands, found {len(bands)}: {bands}"
    for above, below in zip(bands, bands[1:], strict=False):
        assert above != below, f"adjacent bands share one surface: {above!r}"


def _dark_band_segment(content):
    """The markup from the dark band's opening tag to the next band (or EOF)."""
    start = content.index("band--ink")
    rest = content[start:]
    following = BAND_OPEN.search(rest, 1)
    return rest[: following.start()] if following else rest


def test_exactly_one_dark_band_and_it_is_fuer_organisationen(client):
    # Exactly ONE section inverts to the dark ink ground for the graver
    # institutional register: Für Organisationen & Vogelwarten. No other dark
    # surfaces anywhere on the page.
    content = client.get("/").content.decode()
    assert content.count("band--ink") == 1
    segment = _dark_band_segment(content)
    assert 'id="organisationen"' in segment
    # None of the other section anchors ride along inside the dark band.
    for anchor in ('id="fuer-beringer"', 'id="fang-formular"', 'id="preise"'):
        assert anchor not in segment, f"{anchor} leaked into the dark band"


def test_dark_band_keeps_the_gespraech_cta_as_its_button(client):
    from django.urls import reverse

    # The Gespräch path stays prominent INSIDE the dark section — a full
    # button, not a demoted text link — so org decision-makers are not
    # funneled into the Beringer flow.
    content = client.get("/").content.decode()
    segment = _dark_band_segment(content)
    gespraech = reverse("landing:gespraech")
    assert f'class="button" href="{gespraech}"' in segment
    # ...and the Warteliste (Beringer) CTA does not compete inside this band.
    assert reverse("landing:warteliste") not in segment
