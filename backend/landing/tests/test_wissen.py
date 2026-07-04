"""The public /wissen/ reference — Ringgrößen-Tabelle + Artenseiten (PRD #278).

The programmatic SEO reference is German-only and server-rendered (ADR 0009):
`/wissen/ringgroessen/` (issue #280) is a semantic table of every non-Sonderart
species from the global `Species` reference data, and `/wissen/art/<slug>/`
(issue #282) is one page per species under its slugified scientific name —
German name as H1, taxonomy, Empfohlene Ringgröße, a prose-only Artennorm
teaser (the norms stay gated behind signup) and the Warteliste CTA. These
exercise the pages as an unauthenticated visitor (and a crawler) through the
Django test client, at the same seam as `test_seo.py` / `test_legal.py`.
"""

import json
import re
from collections import Counter
from decimal import Decimal

from django.urls import reverse
from django.utils.text import slugify

from birds.models import Species, SpeciesNorm

WISSEN_RINGGROESSEN_URL = "/wissen/ringgroessen/"
SUCHBEGRIFF = "Ringgrößen-Tabelle Österreich"


def test_ringgroessen_page_renders_a_semantic_species_table(client, db):
    # An unauthenticated visitor gets a 200 with a real, semantic <table> whose
    # rows come from the seeded Species reference: German name, scientific
    # name, family/order and the Empfohlene Ringgröße.
    response = client.get(WISSEN_RINGGROESSEN_URL)
    assert response.status_code == 200

    content = response.content.decode()
    assert "<table" in content
    assert "<th" in content

    # A representative seeded species renders with all its reference data.
    kohlmeise = Species.objects.get(scientific_name="Parus major")
    assert kohlmeise.ring_size, "seed data lost Parus major's Empfohlene Ringgröße"
    assert kohlmeise.common_name_de in content  # Kohlmeise
    assert kohlmeise.scientific_name in content
    assert kohlmeise.family_name in content
    assert kohlmeise.order_name in content


def test_sonderart_rows_are_excluded_from_the_table(client, db):
    # The non-taxon Sonderart rows are seeded reference data, but they are not
    # birds — the public table lists only real species.
    assert Species.objects.exclude(special_kind=Species.SpecialKind.NORMAL).count() == 2

    content = client.get(WISSEN_RINGGROESSEN_URL).content.decode().lower()
    assert "ring vernichtet" not in content
    assert "aves ignota" not in content


def test_species_without_ring_size_shows_an_honest_empty_state(client, db):
    # A species with no Empfohlene Ringgröße gets an explicit empty state —
    # never a fabricated value and never Python's literal None.
    Species.objects.create(
        common_name_de="Testart ohne Empfehlung",
        common_name_en="Test species without recommendation",
        scientific_name="Avis probationis",
        family_name="Testidae",
        order_name="Testiformes",
        ring_size=None,
    )

    content = client.get(WISSEN_RINGGROESSEN_URL).content.decode()
    row = content.split("Testart ohne Empfehlung", 1)[1].split("</tr>", 1)[0]
    assert "Keine Standard-Empfehlung" in row
    assert "None" not in row


def test_title_h1_and_intro_copy_target_the_search_term(client, db):
    # The page targets the search „Ringgrößen Tabelle Österreich": the term
    # leads the <title>, the H1 and the intro copy above the table.
    content = client.get(WISSEN_RINGGROESSEN_URL).content.decode()

    title = re.search(r"<title>(.*?)</title>", content, re.DOTALL).group(1)
    assert SUCHBEGRIFF in title

    h1 = re.search(r"<h1[^>]*>(.*?)</h1>", content, re.DOTALL).group(1)
    assert SUCHBEGRIFF in h1

    # Intro copy between the H1 and the table names the term again.
    intro = content.split("</h1>", 1)[1].split("<table", 1)[0]
    assert SUCHBEGRIFF in intro


def test_warteliste_cta_links_the_zugang_anfragen_funnel(client, db):
    # The reference page funnels its visitors into the existing Warteliste —
    # the „Zugang anfragen" form — with the product hook: BirdDoc schlägt die
    # Ringgröße automatisch vor. No new funnel, no new form.
    content = client.get(WISSEN_RINGGROESSEN_URL).content.decode()
    assert "BirdDoc schlägt die Ringgröße automatisch vor" in content
    assert f'href="{reverse("landing:warteliste")}"' in content
    assert "Zugang anfragen" in content


def test_page_carries_parseable_breadcrumblist_jsonld(client, db):
    # A crawler gets a BreadcrumbList JSON-LD block that actually parses — a
    # malformed block must fail loudly, not rank silently.
    content = client.get(WISSEN_RINGGROESSEN_URL).content.decode()

    match = re.search(r'<script type="application/ld\+json">(.*?)</script>', content, re.DOTALL)
    assert match, "no JSON-LD block on the page"

    data = json.loads(match.group(1))
    assert data["@type"] == "BreadcrumbList"
    # The trail ends on this very page, with absolute item URLs.
    items = data["itemListElement"]
    assert [item["position"] for item in items] == list(range(1, len(items) + 1))
    assert items[-1]["name"] == SUCHBEGRIFF
    assert items[-1]["item"].startswith("http")
    assert items[-1]["item"].endswith(WISSEN_RINGGROESSEN_URL)


def test_no_en_variant_is_served(client, db):
    # The reference is deliberately German-only for DACH: the page lives at the
    # apex root outside i18n_patterns, so /en/… is a 404, not a duplicate page.
    assert client.get(WISSEN_RINGGROESSEN_URL).status_code == 200
    assert client.get("/en" + WISSEN_RINGGROESSEN_URL).status_code == 404


def test_artseite_renders_german_h1_taxonomy_and_ringgroesse(client, db):
    # `/wissen/art/<slug>/` answers the search „Ringgröße <Art>": the slug is
    # the slugified scientific name (stable, umlaut-free), but the page leads
    # with the German common name as H1 so it matches the German query on-page.
    kohlmeise = Species.objects.get(scientific_name="Parus major")
    assert kohlmeise.ring_size, "seed data lost Parus major's Empfohlene Ringgröße"

    response = client.get("/wissen/art/parus-major/")
    assert response.status_code == 200

    content = response.content.decode()
    h1 = re.search(r"<h1[^>]*>(.*?)</h1>", content, re.DOTALL).group(1)
    assert kohlmeise.common_name_de in h1  # Kohlmeise

    assert kohlmeise.scientific_name in content
    assert kohlmeise.family_name in content
    assert kohlmeise.order_name in content
    assert "Empfohlene Ringgröße" in content
    assert kohlmeise.ring_size in content


def test_artseite_without_ring_size_shows_keine_standard_empfehlung(client, db):
    # A species with no Empfohlene Ringgröße gets the explicit „keine
    # Standard-Empfehlung" state — the reference never fabricates a value and
    # never leaks Python's literal None.
    Species.objects.create(
        common_name_de="Testart ohne Empfehlung",
        common_name_en="Test species without recommendation",
        scientific_name="Avis probationis",
        family_name="Testidae",
        order_name="Testiformes",
        ring_size=None,
    )

    response = client.get("/wissen/art/avis-probationis/")
    assert response.status_code == 200

    content = response.content.decode()
    assert "keine Standard-Empfehlung" in content
    assert "None" not in content


def _meta_description(content):
    # The <meta name="description"> content of a rendered page. Fails loudly
    # when the tag is missing — an answer-first page without a description
    # snippet is the bug this slice fixes (issue #305).
    match = re.search(r'<meta name="description" content="([^"]*)"', content)
    assert match, 'no <meta name="description"> on the page'
    return match.group(1)


def test_artseite_meta_description_states_the_recommended_ring_size(client, db):
    # Answer-first (issue #305): the Artenseite carries a <meta description>
    # that states the answer — the Empfohlene Ringgröße — so a search snippet
    # and an AI passage-retriever can lift the exact ring size.
    kohlmeise = Species.objects.get(scientific_name="Parus major")
    assert kohlmeise.ring_size, "seed data lost Parus major's Empfohlene Ringgröße"

    description = _meta_description(client.get("/wissen/art/parus-major/").content.decode())
    assert kohlmeise.common_name_de in description
    assert f"Ringgröße {kohlmeise.ring_size}" in description
    assert "Artenliste" in description


def test_artseite_meta_description_no_recommendation_is_honest(client, db):
    # The no-recommendation case states the answer honestly in the meta
    # description too — no fabricated value, never Python's literal None.
    Species.objects.create(
        common_name_de="Testart ohne Empfehlung",
        common_name_en="Test species without recommendation",
        scientific_name="Avis probationis",
        family_name="Testidae",
        order_name="Testiformes",
        ring_size=None,
    )

    description = _meta_description(client.get("/wissen/art/avis-probationis/").content.decode())
    assert "keine Standard-Empfehlung" in description
    assert "None" not in description


def test_artseite_opens_with_an_answer_first_lead(client, db):
    # The first content sentence — the lead directly after the H1 — states the
    # answer (issue #305), so the answer leads the page, not the taxonomy. The
    # visible lead is the very sentence the <meta description> carries.
    kohlmeise = Species.objects.get(scientific_name="Parus major")
    assert kohlmeise.ring_size, "seed data lost Parus major's Empfohlene Ringgröße"

    content = client.get("/wissen/art/parus-major/").content.decode()

    lead = re.search(r'</h1>\s*<p class="lead">(.*?)</p>', content, re.DOTALL)
    assert lead, "the answer-first lead must open the content, right after the H1"
    lead_text = lead.group(1)
    assert f"Ringgröße {kohlmeise.ring_size}" in lead_text
    # The lead precedes the taxonomy line — the answer leads, not the taxonomy.
    assert content.index('<p class="lead">') < content.index("wissen-art__taxonomy")


def test_artseite_answer_first_lead_no_recommendation_is_honest(client, db):
    # The answer-first lead renders the no-recommendation case honestly: the
    # explicit „keine Standard-Empfehlung" state, never a fabricated value and
    # never Python's literal None.
    Species.objects.create(
        common_name_de="Testart ohne Empfehlung",
        common_name_en="Test species without recommendation",
        scientific_name="Avis probationis",
        family_name="Testidae",
        order_name="Testiformes",
        ring_size=None,
    )

    content = client.get("/wissen/art/avis-probationis/").content.decode()

    lead = re.search(r'</h1>\s*<p class="lead">(.*?)</p>', content, re.DOTALL)
    assert lead, "the answer-first lead must open the content, right after the H1"
    lead_text = lead.group(1)
    assert "keine Standard-Empfehlung" in lead_text
    assert "None" not in lead_text


def test_ringgroessen_table_carries_an_answer_first_meta_description(client, db):
    # The Ringgrößen-Tabelle carries an answer-first <meta description> (issue
    # #305): it states what the page answers — the Empfohlene Ringgröße of every
    # Art in der österreichischen Artenliste.
    description = _meta_description(client.get(WISSEN_RINGGROESSEN_URL).content.decode())
    assert "Ringgröße" in description
    assert "österreichischen Artenliste" in description


def test_no_numeric_artennorm_leaks_via_the_meta_description(client, db):
    # The meta description states the ring size (public) but never an Artennorm
    # value (PRD #245 stays gated): a globale Standard-Artennorm on the species
    # must not surface any of its numbers in the description snippet.
    kohlmeise = Species.objects.get(scientific_name="Parus major")
    SpeciesNorm.objects.update_or_create(
        species=kohlmeise,
        organization=None,
        defaults={
            "weight_mean": Decimal("18.734"),
            "weight_sd": Decimal("1.219"),
            "wing_mean": Decimal("74.618"),
            "wing_sd": Decimal("2.437"),
        },
    )

    content = client.get("/wissen/art/parus-major/").content.decode()
    description = _meta_description(content)
    for gated_value in ("18,7", "18.7", "1,219", "1.219", "74,6", "74.6", "2,437", "2.437"):
        assert gated_value not in description


def test_sonderart_and_unknown_slugs_404(client, db):
    # Sonderart rows are not birds and get no page: their slugified scientific
    # names 404 exactly like a slug that never existed.
    sonderarten = Species.objects.exclude(special_kind=Species.SpecialKind.NORMAL)
    assert sonderarten.count() == 2

    for sonderart in sonderarten:
        slug = slugify(sonderart.scientific_name)  # anulus-deletus, aves-ignota
        assert client.get(f"/wissen/art/{slug}/").status_code == 404

    assert client.get("/wissen/art/keine-solche-art/").status_code == 404


def test_artennorm_teaser_is_prose_only_and_norm_values_stay_gated(client, db):
    # Both halves of the gated-norms decision (PRD #245 stays behind the signup
    # wall): the prose teaser converts the visitor, but even when a globale
    # Standard-Artennorm exists for the species, none of its numeric values is
    # ever rendered on the public page.
    kohlmeise = Species.objects.get(scientific_name="Parus major")
    SpeciesNorm.objects.update_or_create(
        species=kohlmeise,
        organization=None,
        defaults={
            "weight_mean": Decimal("18.734"),
            "weight_sd": Decimal("1.219"),
            "wing_mean": Decimal("74.618"),
            "wing_sd": Decimal("2.437"),
        },
    )

    content = client.get("/wissen/art/parus-major/").content.decode()
    assert "BirdDoc warnt bei biologisch unplausiblen Messwerten" in content
    for gated_value in ("18,7", "18.7", "1,219", "1.219", "74,6", "74.6", "2,437", "2.437"):
        assert gated_value not in content


def test_artseite_carries_warteliste_cta_and_breadcrumb_jsonld(client, db):
    # The species page funnels into the existing „Zugang anfragen" Warteliste,
    # and a visible breadcrumb leads back to the Ringgrößen index — mirrored by
    # a BreadcrumbList JSON-LD block that actually parses.
    kohlmeise = Species.objects.get(scientific_name="Parus major")
    content = client.get("/wissen/art/parus-major/").content.decode()

    assert f'href="{reverse("landing:warteliste")}"' in content
    assert "Zugang anfragen" in content

    # Visible breadcrumb back to the index.
    assert 'aria-label="Brotkrümelnavigation"' in content
    assert f'href="http://testserver{WISSEN_RINGGROESSEN_URL}"' in content

    match = re.search(r'<script type="application/ld\+json">(.*?)</script>', content, re.DOTALL)
    assert match, "no JSON-LD block on the page"
    data = json.loads(match.group(1))
    assert data["@type"] == "BreadcrumbList"
    items = data["itemListElement"]
    assert [item["position"] for item in items] == list(range(1, len(items) + 1))
    # The trail passes through the index and ends on this species' page.
    assert items[-2]["name"] == SUCHBEGRIFF
    assert items[-2]["item"].endswith(WISSEN_RINGGROESSEN_URL)
    assert items[-1]["name"] == kohlmeise.common_name_de
    assert items[-1]["item"].startswith("http")
    assert items[-1]["item"].endswith("/wissen/art/parus-major/")


def test_index_table_links_through_to_every_artseite(client, db):
    # The Ringgrößen index is the hub: every non-Sonderart row links to its
    # species page under the stable scientific slug.
    content = client.get(WISSEN_RINGGROESSEN_URL).content.decode()

    scientific_names = Species.objects.filter(special_kind=Species.SpecialKind.NORMAL).values_list(
        "scientific_name", flat=True
    )
    assert scientific_names, "seed data lost the species reference"
    for scientific_name in scientific_names:
        assert f'href="/wissen/art/{slugify(scientific_name)}/"' in content


def test_slugified_scientific_names_are_unique_across_species(db):
    # The slug IS the URL: if two non-Sonderart species ever slugified to the
    # same value, they would collide on one page. This pins the whole seeded
    # reference dataset, not just a sample.
    slugs = [
        slugify(scientific_name)
        for scientific_name in Species.objects.filter(
            special_kind=Species.SpecialKind.NORMAL
        ).values_list("scientific_name", flat=True)
    ]
    assert slugs, "seed data lost the species reference"
    duplicates = {slug: count for slug, count in Counter(slugs).items() if count > 1}
    assert not duplicates, f"colliding species slugs: {duplicates}"


def test_page_is_server_rendered_and_script_free(client, db):
    # Server-rendered on the shared landing base — never the Angular SPA shell
    # — and script-free (ADR 0009): the only <script> on the page is the inert
    # JSON-LD data block; nothing executable, nothing loaded from anywhere.
    response = client.get(WISSEN_RINGGROESSEN_URL)
    template_names = {t.name for t in response.templates}
    assert "landing/base.html" in template_names

    content = response.content.decode()
    assert "app-root" not in content

    script_tags = re.findall(r"<script[^>]*>", content)
    assert script_tags, "the JSON-LD data block should be present"
    for tag in script_tags:
        assert 'type="application/ld+json"' in tag
        assert "src=" not in tag
