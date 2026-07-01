"""The product-proof section — the Fang-Karten-Formular at the Ringtisch (issue #139).

The page never shows the actual product, so a visitor signs up for an app they
have never seen. This section closes that gap in the Für-Beringer reading flow:
the app's real German data-entry form, server-rendered as markup (no screenshot
pipeline, no JS), narratively linked to the hero — the form at the Ringtisch
becomes the clean record. Its content is shaped like Referenzprojekt (BDDEMO)
captures: plausible, non-real ringing data, a frozen module-level constant like
the hero's Fang-Karte specimen (ADR 0009, ADR 0012).
"""

import re

import pytest

from landing.fang_formular import FANG_FORMULAR


def test_home_renders_the_fang_formular_section_in_the_beringer_flow(client):
    # The product-proof section renders server-side inside the Für-Beringer
    # reading flow: after the Für-Beringer audience section, before the
    # Für-Organisationen track — the hero's Fang-Karte keeps the hero slot.
    content = client.get("/").content.decode()
    assert 'id="fang-formular"' in content
    assert content.index('id="fuer-beringer"') < content.index('id="fang-formular"')
    assert content.index('id="fang-formular"') < content.index('id="organisationen"')
    # It reads as the app's real form: the app's own heading and field labels...
    assert "Neuer Beringungseintrag" in content
    for label in (
        "Projekt",
        "Station",
        "Beringer",
        "Datum und Uhrzeit",
        "Art",
        "Status",
        "Ringgröße",
        "Ringnummer",
        "Alter",
        "Geschlecht",
        "Fett",
        "Muskelklasse",
        "Flügellänge (mm)",
        "Gewicht (g)",
    ):
        assert label in content, f"form label {label!r} missing"
    # ...filled with the specimen capture, down at the Ringtisch.
    assert FANG_FORMULAR.common_name_de in content
    assert FANG_FORMULAR.ring_number in content
    assert FANG_FORMULAR.station in content
    assert FANG_FORMULAR.kuerzel in content


def test_formular_specimen_is_referenzprojekt_shaped():
    # The specimen is BDDEMO-shaped by construction (ADR 0012): its Beringer,
    # Station, Ringserie range and species all come from the same fictional
    # Illmitz reed-bed cast the Referenzprojekt is seeded from — plausible,
    # non-real ringing data, never a real person or a real capture row.
    from birds.demo.generate_sample_iwm import RING_BASE, RINGERS, SPECIES, STATIONS

    full_name = f"{FANG_FORMULAR.beringer_first} {FANG_FORMULAR.beringer_last}"
    assert (full_name, FANG_FORMULAR.kuerzel) in RINGERS
    assert FANG_FORMULAR.station in {name for name, *_ in STATIONS}
    # The ring number sits inside the demo Ringserie range for its size.
    base = RING_BASE[FANG_FORMULAR.ring_size]
    assert base < int(FANG_FORMULAR.ring_number) <= base + 1000
    # The species is a Referenzprojekt species, its size matches the demo
    # Ringserie, and the biometrics sit in that species' plausible ranges.
    row = next(s for s in SPECIES if s[1] == FANG_FORMULAR.scientific_name)
    common_de, _sci, size, wing, weight, *_ = row
    assert FANG_FORMULAR.common_name_de == common_de
    assert FANG_FORMULAR.ring_size == size
    assert wing[0] <= float(FANG_FORMULAR.wing_mm) <= wing[1]
    assert weight[0] <= float(FANG_FORMULAR.weight_g.replace(",", ".")) <= weight[1]


def test_formular_kuerzel_is_domain_valid():
    # The Kürzel on the form is the Austrian standard (CONTEXT.md), verified
    # against the single source of truth — mirroring the hero-card guard.
    from birds.kuerzel import derive_handle

    assert FANG_FORMULAR.kuerzel == derive_handle(
        FANG_FORMULAR.beringer_first, FANG_FORMULAR.beringer_last
    )


@pytest.mark.django_db
def test_formular_ring_size_is_the_empfohlene_ringgroesse_for_that_species():
    # The ring rides the size the app itself recommends for THAT species (its
    # Empfohlene Ringgröße in the seeded Species table), and a real code in the
    # Austrian ring-size scheme — the form preview stays true to the product.
    from birds.models import Ring, Species

    species = Species.objects.get(scientific_name=FANG_FORMULAR.scientific_name)
    assert species.common_name_de == FANG_FORMULAR.common_name_de
    assert FANG_FORMULAR.ring_size == species.ring_size
    assert FANG_FORMULAR.ring_size in Ring.RingSizes.values


def test_formular_renders_without_real_fangdaten_markers(client):
    # ADR 0012 boundary: the demo captures are explicitly NOT Fangdaten, and no
    # real Fangdaten render anywhere. This test carries no django_db marker, so
    # the section provably renders from the frozen constant on an unseeded
    # database — never a per-request read of anybody's captures. The
    # reality-linking markers a real capture row carries (and the anonymiser
    # strips) never reach the page:
    content = client.get("/").content.decode()
    # ...no geo-coordinates that could expose a real (possibly protected) site
    # (the IWM Geo-Koordinaten shape, e.g. 47.769000 — dd.mm.yyyy dates with
    # their four-digit year deliberately don't trip this),
    assert not re.search(r"\d{1,3}\.\d{5,}", content), "coordinate-shaped value rendered"
    # ...no official Ortskodierung place code of a ringing authority,
    assert "Ortskodierung" not in content
    assert not re.search(r"\b(?:NS|AU)\d{2}\b", content), "Ortskodierung-shaped code rendered"
    # ...and no scheme/ring-authority prefix riding the ring number (the demo
    # Ringserie is plain size + number, renumbered into a demo range).
    assert "AUW" not in content


def test_formular_section_carries_a_landmark_and_heading_structure(client):
    # A screen reader lands on a proper region: the <section> takes its
    # accessible name from its own <h2>, so the section is a named landmark and
    # the heading sits in the page outline like its sibling sections.
    content = client.get("/").content.decode()
    assert 'aria-labelledby="fang-formular-title"' in content
    assert re.search(r'<section[^>]*id="fang-formular"[^>]*aria-labelledby=', content)
    assert re.search(r'<h2 id="fang-formular-title"', content)


def test_formular_labels_stay_german_under_en_while_narrative_translates(client):
    # The form preview is an honest preview of the German app itself, so its
    # field labels stay German even under /en/ (the app-is-German-only note
    # already sets that expectation) — while the surrounding narrative copy
    # switches with the language like the rest of the marketing surface.
    de = client.get("/").content.decode()
    en = client.get("/en/").content.decode()
    # The narrative translates...
    assert "Das Formular am Ringtisch" in de
    assert "The form at the ringing table" in en
    assert "Das Formular am Ringtisch" not in en
    # ...the form's labels stay honestly German on both pages...
    for label in (
        "Ringnummer",
        "Ringgröße",
        "Muskelklasse",
        "Flügellänge (mm)",
        "Datum und Uhrzeit",
    ):
        assert label in de, f"form label {label!r} missing on the German page"
        assert label in en, f"form label {label!r} did not stay German under /en/"
    # ...and so does the specimen content itself (the app's own select labels).
    assert FANG_FORMULAR.common_name_de in en
    assert FANG_FORMULAR.age in en


def test_formular_preview_is_inert_markup_not_an_interactive_form(client):
    # The preview is server-rendered markup styled to READ as the app's form —
    # not a screenshot, and not a real form a visitor could tab into or try to
    # submit: the section ships no form controls and needs no JavaScript.
    # (The page-level nav.js enhancement and its toggle button live outside
    # this section and are pinned by test_nav_toggle.py.)
    content = client.get("/").content.decode()
    start = content.index('id="fang-formular"')
    section = content[start : content.index("</section>", start)].lower()
    assert "<script" not in section
    assert "<form" not in section
    assert "<input" not in section
    assert "<button" not in section
    # The home as a whole still carries no real form controls a visitor
    # could fill in or submit.
    assert "<form" not in content.lower()
    assert "<input" not in content.lower()
