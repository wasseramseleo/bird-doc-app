"""The public /wissen/ reference — Ringgrößen-Tabelle Österreich (issue #280).

The programmatic SEO reference (PRD #278) starts with one German-only page at
`/wissen/ringgroessen/`: a server-rendered semantic table of every non-Sonderart
species from the global `Species` reference data — German name, scientific
name, family/order and Empfohlene Ringgröße — so the public reference can never
drift from the app's own Austrian list. These exercise the page as an
unauthenticated visitor (and a crawler) through the Django test client, at the
same seam as `test_seo.py` / `test_legal.py` (ADR 0009: server-rendered, no SPA).
"""

import json
import re

from birds.models import Species

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
    from django.urls import reverse

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
