"""The hero's signature Fang-Karte + Ringserie number thread (issue #106).

These exercise the apex landing page as an unauthenticated visitor reaches it
and cross-check the static specimen against the *domain* — the Kürzel rule and
the seeded Empfohlene Ringgröße — so the hero stays ornithologically credible,
never a mockup that drifts from the product (ADR 0009; CONTEXT.md: Ringserie,
Empfohlene Ringgröße, Kürzel).
"""

from pathlib import Path

import pytest

from landing.fang_karte import FANG_KARTE

LANDING_CSS = Path(__file__).resolve().parent.parent / "static" / "landing" / "landing.css"


def _hero_ctas(content):
    # The hero's CTA row — the <p class="hero__ctas"> block only, so the
    # assertions read the hero's own buttons, not CTAs further down the page.
    start = content.index("hero__ctas")
    return content[start : content.index("</p>", start)]


def test_hero_primary_cta_resolves_to_the_warteliste_route(client):
    # A Beringer convinced by the hero can act on it right there: the primary
    # hero CTA is "Zugang anfragen", wired to the Warteliste route (issue #138)
    # — on the German apex...
    from django.urls import reverse

    de_ctas = _hero_ctas(client.get("/").content.decode())
    assert reverse("landing:warteliste") in de_ctas
    assert "Zugang anfragen" in de_ctas
    # ...and under /en/, where the same CTA renders translated and the route
    # carries the language prefix.
    en_ctas = _hero_ctas(client.get("/en/").content.decode())
    assert "/en/zugang-anfragen/" in en_ctas
    assert "Request access" in en_ctas


def test_hero_secondary_cta_anchors_to_the_fuer_organisationen_section(client):
    # The second audience keeps its fork: a secondary ghost button anchoring
    # down to the Für-Organisationen section (issue #138).
    ctas = _hero_ctas(client.get("/").content.decode())
    assert 'href="#organisationen"' in ctas
    assert "button--ghost" in ctas


def test_the_fuer_beringer_hero_anchor_is_gone(client):
    # The "Für Beringer" hero anchor is dropped (issue #138): the page's default
    # reading flow IS the Beringer path, so the hero needs no anchor to it. The
    # section itself stays, reachable by simply reading on (and via the fork band).
    content = client.get("/").content.decode()
    ctas = _hero_ctas(content)
    assert "#fuer-beringer" not in ctas
    assert "Für Beringer" not in ctas
    assert 'id="fuer-beringer"' in content


def test_hero_renders_a_static_fang_karte_with_the_real_species(client):
    # The hero placeholder is replaced by the page's signature: a static
    # Fang-Karte for a real Artenliste species.
    content = client.get("/").content.decode()
    assert "fang-karte" in content
    assert FANG_KARTE.common_name_de in content


def test_fang_karte_carries_the_full_capture_record(client):
    # The card reads like a real record: the ring (size + number), plausible
    # biometrics, age/sex, the Station, the Datum, and the responsible Beringer's
    # Kürzel — one record per captured bird.
    content = client.get("/").content.decode()
    assert FANG_KARTE.ring_size in content
    assert FANG_KARTE.ring_number in content
    assert FANG_KARTE.wing_mm in content
    assert FANG_KARTE.weight_g in content
    assert FANG_KARTE.age in content
    assert FANG_KARTE.sex in content
    assert FANG_KARTE.station in content
    assert FANG_KARTE.datum in content
    assert FANG_KARTE.kuerzel in content


def test_ringserie_thread_renders_a_sequential_run_threading_the_page(client):
    # The Ringserie thread threads the page as an honest structural marker.
    content = client.get("/").content.decode()
    assert "ringserie" in content
    # Every consumed number in the run renders, in order.
    for number in FANG_KARTE.ringserie:
        assert number in content


def test_ringserie_run_is_a_real_consumed_sequence_not_decorative(client):
    # The run reflects the REAL rule: consecutive consumed numbers off the rope
    # (last-consumed + 1), leading-zero width preserved, ending at the card's ring
    # number — not a decorative 01 / 02 / 03.
    run = [int(n) for n in FANG_KARTE.ringserie]
    assert run == list(range(run[0], run[0] + len(run)))
    assert FANG_KARTE.ringserie[-1] == FANG_KARTE.ring_number
    assert all(len(n) == len(FANG_KARTE.ring_number) for n in FANG_KARTE.ringserie)
    # The next suggestion is last-consumed + 1, same width.
    assert int(FANG_KARTE.next_number) == int(FANG_KARTE.ring_number) + 1
    assert len(FANG_KARTE.next_number) == len(FANG_KARTE.ring_number)


def test_ringserie_thread_carries_a_caption_naming_the_consumed_numbers(client):
    # The number thread names what it is (issue #138): fortlaufend verbrauchte
    # Ringnummern aus dem Stationsbetrieb, and the next-number rule — the next
    # number is the last consumed + 1 (CONTEXT.md: Ringserie). Decoration
    # becomes evidence.
    content = client.get("/").content.decode()
    assert "ringserie__caption" in content
    assert "verbrauchte Ringnummern aus dem Stationsbetrieb" in content
    assert "die nächste Nummer ist die letzte verbrauchte + 1" in content


def test_ringserie_caption_is_translated_under_en(client):
    # The caption is marketing copy on the bilingual surface (issue #107), so it
    # flips with the language like the rest of the page.
    en = client.get("/en/").content.decode()
    assert "ringserie__caption" in en
    assert "the next number is the last consumed + 1" in en
    assert "die nächste Nummer ist die letzte verbrauchte + 1" not in en


def test_ringserie_numbers_are_set_in_the_tabular_nums_data_voice():
    # Ring numbers and biometrics are the brand's "data voice" — Inter tabular-nums.
    css = LANDING_CSS.read_text()
    assert "tabular-nums" in css


def test_card_kuerzel_is_domain_valid(client):
    # The Kürzel on the card is the Austrian standard (CONTEXT.md) — first letter
    # of the first name + first two of the surname — verified against the single
    # source of truth, derive_handle, and actually rendered on the page.
    from birds.kuerzel import derive_handle

    assert FANG_KARTE.kuerzel == derive_handle(FANG_KARTE.beringer_first, FANG_KARTE.beringer_last)
    content = client.get("/").content.decode()
    assert FANG_KARTE.kuerzel in content


@pytest.mark.django_db
def test_card_ring_size_is_valid_for_that_species(client):
    # The ring rides a size that is valid FOR THAT SPECIES: it equals the
    # Empfohlene Ringgröße the app records for the species (Species.ring_size),
    # and is a real code in the Austrian ring-size scheme.
    from birds.models import Ring, Species

    species = Species.objects.get(scientific_name=FANG_KARTE.scientific_name)
    assert species.common_name_de == FANG_KARTE.common_name_de
    assert FANG_KARTE.ring_size == species.ring_size
    assert FANG_KARTE.ring_size in Ring.RingSizes.values

    content = client.get("/").content.decode()
    assert FANG_KARTE.ring_size in content


def test_home_ships_only_the_landings_own_first_party_script(client):
    # The card itself carries no JS. Since issue #141 the page ships the
    # landing's single light JavaScript file — the progressive nav-toggle
    # enhancement, served from the landing's own statics — and nothing else:
    # no third-party script, no inline script (test_nav_toggle pins the rest).
    content = client.get("/").content.decode()
    assert content.lower().count("<script") == 1
    assert 'src="/static/landing/nav.js"' in content


def test_the_only_motion_is_the_thread_reveal_and_it_is_reduced_motion_aware():
    # The page's single motion is the number-thread reveal — there is exactly one
    # animation in the whole landing stylesheet — and it is fully suppressed under
    # prefers-reduced-motion (declared only inside a no-preference guard, so under
    # `reduce` the thread simply appears in its final, visible state).
    css = LANDING_CSS.read_text()
    assert css.count("@keyframes") == 1
    assert "ringserie--reveal" in css
    assert "prefers-reduced-motion" in css
    # The reveal lives behind the no-preference guard; no bare animation escapes it.
    guard = "@media (prefers-reduced-motion: no-preference)"
    assert guard in css
    assert css.index(guard) < css.index("ringserie-reveal")


def test_no_stock_photography_is_introduced(client):
    # Visuals are self-sourced from the app's own language — the only image is the
    # brand logo; no stock photography, no external image hosts.
    content = client.get("/").content.decode()
    assert content.count("<img") == 1
    assert "birddoc-logo" in content
    for marker in ("unsplash", "shutterstock", "pexels", "istockphoto", ".jpg", ".jpeg"):
        assert marker not in content.lower()
    css = LANDING_CSS.read_text().lower()
    assert "url(http" not in css
    assert ".jpg" not in css and ".jpeg" not in css
