"""The public Beringungs-Glossar — Wissen's field-domain vocabulary (PRD #300).

The Glossar is repo-versioned editorial content (not database rows): the entries
ship in `landing/glossar.py`, get reviewed and tested like code. Like the rest
of the Wissen reference it is deliberately German-only and server-rendered
(ADR 0009): `/wissen/glossar/` is the index and `/wissen/glossar/<slug>/` is one
page per term, both at the apex root outside `i18n_patterns` (one canonical URL
per topic, no `/en/` variant). These exercise the pages as an unauthenticated
visitor (and a crawler) through the Django test client — the same seam as
`test_wissen.py` / `test_seo.py` — asserting external behaviour, never template
internals.
"""

import json
import re

from landing.glossar import GLOSSAR_ENTRIES

GLOSSAR_INDEX_URL = "/wissen/glossar/"


def test_glossar_index_returns_200_and_lists_every_seeded_term(client):
    # The index is the hub: it returns 200 and names every seeded term, each
    # linking through to its own page under a stable slug.
    response = client.get(GLOSSAR_INDEX_URL)
    assert response.status_code == 200

    content = response.content.decode()
    assert GLOSSAR_ENTRIES, "the glossar ships with seed terms"
    for entry in GLOSSAR_ENTRIES:
        assert entry.begriff in content
        assert f'href="/wissen/glossar/{entry.slug}/"' in content


def test_glossar_index_carries_a_title_meta_description_and_breadcrumb(client):
    # The index names the section in its <title>, carries its own meta
    # description, and sits in the Wissen breadcrumb trail (BreadcrumbList
    # JSON-LD) ending on itself with an absolute URL.
    content = client.get(GLOSSAR_INDEX_URL).content.decode()

    title = re.search(r"<title>(.*?)</title>", content, re.DOTALL).group(1)
    assert "Beringungs-Glossar" in title

    assert re.search(r'<meta name="description" content="[^"]+"', content)

    match = re.search(r'<script type="application/ld\+json">(.*?)</script>', content, re.DOTALL)
    assert match, "no JSON-LD block on the glossar index"
    data = json.loads(match.group(1))
    assert data["@type"] == "BreadcrumbList"
    items = data["itemListElement"]
    assert [item["position"] for item in items] == list(range(1, len(items) + 1))
    assert items[-1]["name"] == "Beringungs-Glossar"
    assert items[-1]["item"].startswith("http")
    assert items[-1]["item"].endswith(GLOSSAR_INDEX_URL)


def test_each_term_names_the_term_in_its_title(client):
    # Each term page carries its Begriff in the <title> (issue #306).
    for entry in GLOSSAR_ENTRIES:
        content = client.get(f"/wissen/glossar/{entry.slug}/").content.decode()
        title = re.search(r"<title>(.*?)</title>", content, re.DOTALL).group(1)
        assert entry.begriff in title


def test_every_seeded_term_has_its_own_page_and_unknown_slugs_404(client):
    # One route per term: each seeded slug returns 200 with the term as its H1,
    # while a slug that was never authored 404s.
    for entry in GLOSSAR_ENTRIES:
        response = client.get(f"/wissen/glossar/{entry.slug}/")
        assert response.status_code == 200
        h1 = re.search(r"<h1[^>]*>(.*?)</h1>", response.content.decode(), re.DOTALL).group(1)
        assert entry.begriff in h1

    assert client.get("/wissen/glossar/kein-solcher-begriff/").status_code == 404


def test_each_term_renders_answer_first_with_its_lead_as_the_first_paragraph(client):
    # Answer-first (PRD #300 story 9): the entry's direct-definition lead is the
    # very first paragraph after the H1, so an AI answer engine lifts the answer,
    # not the breadcrumb or an eyebrow.
    for entry in GLOSSAR_ENTRIES:
        content = client.get(f"/wissen/glossar/{entry.slug}/").content.decode()
        after_h1 = content.split("</h1>", 1)[1]
        first_paragraph = re.search(r"<p[^>]*>(.*?)</p>", after_h1, re.DOTALL).group(1)
        assert entry.lead in first_paragraph


def test_each_term_carries_its_own_meta_description(client):
    # A per-term <meta name="description"> — the search/AI snippet — stating the
    # answer, one per page (issue #306).
    for entry in GLOSSAR_ENTRIES:
        content = client.get(f"/wissen/glossar/{entry.slug}/").content.decode()
        match = re.search(r'<meta name="description" content="([^"]+)"', content)
        assert match, f"no meta description on {entry.slug}"
        assert match.group(1) == entry.meta_description


def test_each_term_carries_a_parseable_breadcrumblist_through_the_glossar_index(client):
    # A crawler gets a BreadcrumbList JSON-LD that parses and leads back through
    # the Beringungs-Glossar index to this very term, with absolute item URLs.
    for entry in GLOSSAR_ENTRIES:
        url = f"/wissen/glossar/{entry.slug}/"
        content = client.get(url).content.decode()

        match = re.search(r'<script type="application/ld\+json">(.*?)</script>', content, re.DOTALL)
        assert match, f"no JSON-LD block on {entry.slug}"
        data = json.loads(match.group(1))
        assert data["@type"] == "BreadcrumbList"

        items = data["itemListElement"]
        assert [item["position"] for item in items] == list(range(1, len(items) + 1))
        # The trail passes through the glossar index and ends on this term's page.
        assert items[-2]["name"] == "Beringungs-Glossar"
        assert items[-2]["item"].endswith(GLOSSAR_INDEX_URL)
        assert items[-1]["name"] == entry.begriff
        assert items[-1]["item"].startswith("http")
        assert items[-1]["item"].endswith(url)


def test_glossar_has_no_en_variant(client):
    # The glossar is deliberately German-only for DACH, consistent with the rest
    # of Wissen: it lives at the apex root outside i18n_patterns, so /en/… is a
    # 404, not a duplicate page. Both the index and the term pages.
    assert client.get(GLOSSAR_INDEX_URL).status_code == 200
    assert client.get("/en" + GLOSSAR_INDEX_URL).status_code == 404

    for entry in GLOSSAR_ENTRIES:
        assert client.get(f"/wissen/glossar/{entry.slug}/").status_code == 200
        assert client.get(f"/en/wissen/glossar/{entry.slug}/").status_code == 404


def test_glossar_pages_are_server_rendered_and_script_free(client):
    # Server-rendered on the shared landing base — never the Angular SPA shell —
    # and script-free (ADR 0009): the only <script> is the inert BreadcrumbList
    # JSON-LD data block; nothing executable, nothing loaded from anywhere.
    for url in [GLOSSAR_INDEX_URL] + [f"/wissen/glossar/{e.slug}/" for e in GLOSSAR_ENTRIES]:
        response = client.get(url)
        template_names = {t.name for t in response.templates}
        assert "landing/base.html" in template_names

        content = response.content.decode()
        assert "app-root" not in content

        script_tags = re.findall(r"<script[^>]*>", content)
        assert script_tags, f"the JSON-LD data block should be present on {url}"
        for tag in script_tags:
            assert 'type="application/ld+json"' in tag
            assert "src=" not in tag


def _sitemap_glossar_urls(client):
    # Every /wissen/glossar/… path advertised in the one sitemap.xml. (db: the
    # combined sitemap also renders the Species-derived Wissen section.)
    content = client.get("/sitemap.xml").content.decode()
    return set(re.findall(r"<loc>[^<]*(/wissen/glossar/[^<]*)</loc>", content))


def test_sitemap_lists_the_glossar_index_and_every_term(client, db):
    # The glossar sitemap section advertises the index plus one URL per seeded
    # term, in the same sitemap.xml robots.txt already points at.
    urls = _sitemap_glossar_urls(client)
    assert GLOSSAR_INDEX_URL in urls
    for entry in GLOSSAR_ENTRIES:
        assert f"/wissen/glossar/{entry.slug}/" in urls


def test_sitemap_glossar_section_matches_the_routable_set_exactly(client, db):
    # No-drift (established Wissen pattern): the glossar URLs in the sitemap are
    # EXACTLY the index plus one per entry — derived from the same GLOSSAR_ENTRIES
    # source as the pages — so the sitemap can neither miss a term nor advertise
    # one that 404s.
    routable = {GLOSSAR_INDEX_URL} | {f"/wissen/glossar/{e.slug}/" for e in GLOSSAR_ENTRIES}
    assert _sitemap_glossar_urls(client) == routable


def test_every_glossar_url_in_the_sitemap_resolves(client, db):
    # The no-drift guarantee, exercised: every glossar URL the sitemap advertises
    # actually returns 200 (never a promised page that 404s).
    for url in _sitemap_glossar_urls(client):
        assert client.get(url).status_code == 200


def test_glossar_sitemap_entries_are_monthly_and_index_outranks_the_terms(client, db):
    # The editorial glossar changes rarely, so every entry is monthly; the index
    # is the hub of the section and outranks the term leaf pages.
    content = client.get("/sitemap.xml").content.decode()
    entries = {
        path: (changefreq, float(priority))
        for path, changefreq, priority in re.findall(
            r"<url>\s*<loc>[^<]*(/wissen/glossar/[^<]*)</loc>\s*"
            r"(?:<lastmod>[^<]*</lastmod>\s*)?"
            r"<changefreq>([^<]*)</changefreq>\s*<priority>([^<]*)</priority>\s*</url>",
            content,
        )
    }
    assert GLOSSAR_INDEX_URL in entries
    assert all(changefreq == "monthly" for changefreq, _ in entries.values())

    index_priority = entries[GLOSSAR_INDEX_URL][1]
    term_priorities = {
        priority for path, (_, priority) in entries.items() if path != GLOSSAR_INDEX_URL
    }
    assert term_priorities, "no glossar term entries in the sitemap"
    assert all(index_priority > term for term in term_priorities)
