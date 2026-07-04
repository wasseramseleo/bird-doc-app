"""The public /wissen/ index hub — the front door of the Wissen reference (#314).

`/wissen/` was a 404: the Ringgrößen-Tabelle was only a de-facto hub. This slice
turns `/wissen/` into a real index that describes what the Wissen reference
contains and links its sections — the Ringgrößen-Tabelle, the Artenseiten and the
Beringungs-Glossar — so a reader and a machine reader can grasp and link the
section as a whole (PRD #300, user story 10).

Like the rest of the Wissen reference it is deliberately German-only and
server-rendered (ADR 0009): it lives at the apex root outside `i18n_patterns`
(one canonical URL, no `/en/` variant). These exercise the page as an
unauthenticated visitor (and a crawler) through the Django test client — the same
seam as `test_wissen.py` / `test_glossar.py` — asserting external behaviour,
never template internals.
"""

import json
import re

WISSEN_HUB_URL = "/wissen/"


def test_wissen_hub_returns_200(client, db):
    # `/wissen/` is a real page now, not a 404: the front door of the reference.
    assert client.get(WISSEN_HUB_URL).status_code == 200


def test_hub_links_all_three_reference_sections(client, db):
    # The hub links its sections so a reader — and a machine reader — can grasp
    # and link the reference as a whole: the Ringgrößen-Tabelle, the Artenseiten
    # and the Beringungs-Glossar, each named and linked.
    content = client.get(WISSEN_HUB_URL).content.decode()

    # Named as sections in prose/headings.
    assert "Ringgrößen-Tabelle" in content
    assert "Artenseiten" in content
    assert "Beringungs-Glossar" in content

    # Linked to the two section indexes.
    assert 'href="/wissen/ringgroessen/"' in content
    assert 'href="/wissen/glossar/"' in content

    # And linked into the Artenseiten section: a real /wissen/art/<slug>/ deep
    # link that actually resolves (the section is not a dead end).
    art_link = re.search(r'href="(/wissen/art/[^"]+/)"', content)
    assert art_link, "the hub must link into the Artenseiten section"
    assert client.get(art_link.group(1)).status_code == 200


def test_hub_carries_a_title_and_answer_first_meta_description(client, db):
    # The hub names the section in its <title> and carries an answer-first
    # <meta name="description"> that states what the reference contains — so the
    # search snippet is useful and an AI retriever can grasp the section's scope.
    content = client.get(WISSEN_HUB_URL).content.decode()

    title = re.search(r"<title>(.*?)</title>", content, re.DOTALL).group(1)
    assert "Wissen" in title

    description = re.search(r'<meta name="description" content="([^"]+)"', content)
    assert description, 'no <meta name="description"> on the hub'
    snippet = description.group(1)
    # Answer-first: the description names the reference's own sections.
    assert "Ringgrößen-Tabelle" in snippet
    assert "Beringungs-Glossar" in snippet


def test_hub_carries_a_parseable_breadcrumblist_jsonld(client, db):
    # A crawler gets a BreadcrumbList JSON-LD trail that actually parses and ends
    # on this very hub with an absolute URL — the hub sits in the Wissen
    # breadcrumb trail like the existing Wissen pages.
    content = client.get(WISSEN_HUB_URL).content.decode()

    match = re.search(r'<script type="application/ld\+json">(.*?)</script>', content, re.DOTALL)
    assert match, "no JSON-LD block on the hub"
    data = json.loads(match.group(1))
    assert data["@type"] == "BreadcrumbList"

    items = data["itemListElement"]
    assert [item["position"] for item in items] == list(range(1, len(items) + 1))
    # The trail ends on the Wissen hub, with an absolute item URL.
    assert items[-1]["name"] == "Wissen"
    assert items[-1]["item"].startswith("http")
    assert items[-1]["item"].endswith(WISSEN_HUB_URL)


def test_hub_has_no_en_variant(client, db):
    # The hub is deliberately German-only for DACH, consistent with the rest of
    # Wissen: it lives at the apex root outside i18n_patterns, so /en/wissen/ is
    # a 404, not a duplicate page.
    assert client.get(WISSEN_HUB_URL).status_code == 200
    assert client.get("/en" + WISSEN_HUB_URL).status_code == 404


def test_hub_is_server_rendered_and_script_free(client, db):
    # Server-rendered on the shared landing base — never the Angular SPA shell —
    # and script-free (ADR 0009): the only <script> on the page is the inert
    # BreadcrumbList JSON-LD data block; nothing executable, nothing loaded.
    response = client.get(WISSEN_HUB_URL)
    template_names = {t.name for t in response.templates}
    assert "landing/base.html" in template_names

    content = response.content.decode()
    assert "app-root" not in content

    script_tags = re.findall(r"<script[^>]*>", content)
    assert script_tags, "the JSON-LD data block should be present"
    for tag in script_tags:
        assert 'type="application/ld+json"' in tag
        assert "src=" not in tag


def _sitemap_wissen_paths(client):
    # Every /wissen/… path advertised in the one sitemap.xml, captured
    # scheme-independently (the Wissen sitemap section is served over https).
    content = client.get("/sitemap.xml").content.decode()
    return set(re.findall(r"<loc>[^<]*(/wissen/[^<]*)</loc>", content))


def test_sitemap_advertises_the_wissen_hub(client, db):
    # The hub joins the same sitemap.xml robots.txt already points at, so a
    # crawler discovers the front door of the reference.
    assert WISSEN_HUB_URL in _sitemap_wissen_paths(client)


def test_sitemap_hub_entry_derives_from_the_route_and_resolves(client, db):
    # No-drift (established Wissen pattern): the hub URL the sitemap advertises is
    # exactly the reversed `wissen_index` route, and it resolves to a 200 — the
    # sitemap can neither advertise a hub that 404s nor drift from the route.
    from django.urls import reverse

    hub_path = reverse("wissen_index")
    assert hub_path == WISSEN_HUB_URL
    assert hub_path in _sitemap_wissen_paths(client)
    assert client.get(hub_path).status_code == 200


def test_sitemap_hub_outranks_the_ringgroessen_index(client, db):
    # The hub is the front door of the whole reference: it carries a monthly
    # changefreq like the rest of Wissen and a priority above the Ringgrößen
    # index (which is itself the hub of the section below it).
    entries = {
        path: (changefreq, float(priority))
        for path, changefreq, priority in re.findall(
            r"<url>\s*<loc>[^<]*(/wissen/[^<]*)</loc>\s*"
            r"(?:<lastmod>[^<]*</lastmod>\s*)?"
            r"<changefreq>([^<]*)</changefreq>\s*<priority>([^<]*)</priority>\s*</url>",
            client.get("/sitemap.xml").content.decode(),
        )
    }
    assert WISSEN_HUB_URL in entries
    assert entries[WISSEN_HUB_URL][0] == "monthly"
    assert entries[WISSEN_HUB_URL][1] > entries["/wissen/ringgroessen/"][1]
