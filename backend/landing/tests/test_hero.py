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
