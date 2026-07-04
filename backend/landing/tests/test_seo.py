"""SEO / Open Graph / share baseline for the public surface (issue #108).

These exercise the apex landing as an unauthenticated visitor — and the crawler
endpoints (`robots.txt`, `sitemap.xml`) and the share image — through the Django
test client, asserting the SEO/OG tags are present and that the crawler files are
served (ADR 0009: the public surface is server-rendered Django).
"""

import pytest
from django.utils import translation


@pytest.fixture(autouse=True)
def _restore_active_language():
    # A request to /en/ leaves "en" active on the thread (LocaleMiddleware
    # activates, nothing deactivates), and a later test's bare reverse() would
    # then build /en/ URLs. Restore whatever was active so this module leaks
    # no language state into whichever test pytest-django orders next (same
    # guard as test_stats.py).
    language = translation.get_language()
    yield
    translation.activate(language)


def test_robots_txt_is_served(client):
    # A crawler hitting /robots.txt gets a plain-text policy, served at the apex
    # root (no language prefix).
    response = client.get("/robots.txt")
    assert response.status_code == 200
    assert response["Content-Type"].startswith("text/plain")


def test_robots_txt_points_at_the_sitemap(client):
    # robots.txt advertises the sitemap so crawlers can discover the public pages.
    content = client.get("/robots.txt").content.decode()
    assert "Sitemap:" in content
    assert "/sitemap.xml" in content


def test_sitemap_xml_is_served(client, db):
    # /sitemap.xml returns 200 as XML, also at the apex root. (The db fixture:
    # since issue #284 the one sitemap also renders the species reference.)
    response = client.get("/sitemap.xml")
    assert response.status_code == 200
    assert "xml" in response["Content-Type"]


def test_sitemap_lists_the_public_pages(client, db):
    # The sitemap advertises the marketing home and the public lead/legal pages
    # crawlers should index, by their canonical (default-language) URLs.
    from django.urls import reverse

    content = client.get("/sitemap.xml").content.decode()
    for name in ("home", "warteliste", "gespraech", "impressum", "datenschutz", "agb"):
        assert reverse(f"landing:{name}") in content


def test_sitemap_lists_the_wissen_reference(client, db):
    # The species-reference sitemap (issue #284) advertises the whole /wissen/
    # section in the same sitemap.xml robots.txt already points at: the
    # Ringgrößen index plus one URL per species page — here a representative
    # seeded species under its stable scientific slug.
    content = client.get("/sitemap.xml").content.decode()
    assert "/wissen/ringgroessen/" in content
    assert "/wissen/art/parus-major/" in content


def test_sitemap_advertises_exactly_one_entry_per_non_sonderart_species(client, db):
    # One <url> per real bird, none for the non-taxon Sonderart rows: the
    # sitemap is derived from the same Species reference (and the same slug
    # rule) as the pages, so it can neither miss a species page nor advertise
    # a Sonderart slug that 404s.
    import re

    from django.utils.text import slugify

    from birds.models import Species

    content = client.get("/sitemap.xml").content.decode()
    species_urls = re.findall(r"<loc>[^<]*(/wissen/art/[^<]+)</loc>", content)

    real_species = Species.objects.filter(special_kind=Species.SpecialKind.NORMAL)
    assert real_species.exists(), "seed data lost the species reference"
    assert len(species_urls) == len(set(species_urls)) == real_species.count()

    sonderarten = Species.objects.exclude(special_kind=Species.SpecialKind.NORMAL)
    assert sonderarten.count() == 2
    for sonderart in sonderarten:
        assert f"/wissen/art/{slugify(sonderart.scientific_name)}/" not in species_urls


def test_wissen_sitemap_entries_are_monthly_and_the_index_outranks_the_leaves(client, db):
    # The species data changes rarely, so every /wissen/ entry is monthly; the
    # Ringgrößen index is the hub of the section and carries a higher priority
    # than the species leaf pages.
    import re

    content = client.get("/sitemap.xml").content.decode()
    entries = {
        path: (changefreq, priority)
        for path, changefreq, priority in re.findall(
            r"<url>\s*<loc>[^<]*(/wissen/[^<]+)</loc>\s*"
            r"(?:<lastmod>[^<]*</lastmod>\s*)?"
            r"<changefreq>([^<]*)</changefreq>\s*<priority>([^<]*)</priority>\s*</url>",
            content,
        )
    }
    assert "/wissen/ringgroessen/" in entries
    assert "/wissen/art/parus-major/" in entries

    assert all(changefreq == "monthly" for changefreq, _ in entries.values())

    index_priority = float(entries["/wissen/ringgroessen/"][1])
    leaf_priorities = {
        float(priority)
        for path, (_, priority) in entries.items()
        if path != "/wissen/ringgroessen/"
    }
    assert leaf_priorities, "no species leaf entries in the sitemap"
    assert all(index_priority > leaf for leaf in leaf_priorities)


def test_og_image_is_served_as_svg(client):
    # The share image is a server-rendered SVG (no raster build pipeline — ADR
    # 0009), served at the apex root.
    response = client.get("/og/fang-karte.svg")
    assert response.status_code == 200
    assert response["Content-Type"].startswith("image/svg+xml")
    assert response.content.decode().lstrip().startswith("<svg") or "<svg" in (
        response.content.decode()
    )


def test_og_image_is_a_rendering_of_the_hero_fang_karte(client):
    # The share image is a rendering of the SAME hero Fang-Karte specimen — the
    # real species, its ring (size + number) and the Beringer's Kürzel — so it
    # can never drift from the hero card (single source of truth: FANG_KARTE).
    from landing.fang_karte import FANG_KARTE

    content = client.get("/og/fang-karte.svg").content.decode()
    assert FANG_KARTE.common_name_de in content
    assert FANG_KARTE.scientific_name in content
    assert FANG_KARTE.ring_size in content
    assert FANG_KARTE.ring_number in content
    assert FANG_KARTE.kuerzel in content
    # The product is named on the share image so the brand reads in a preview.
    assert "BirdDoc" in content


def test_home_carries_seo_meta_description(client):
    # The marketing home carries an SEO meta description describing the product.
    content = client.get("/").content.decode()
    assert '<meta name="description"' in content


def test_home_carries_open_graph_title_description_image(client):
    # The marketing home carries Open-Graph tags (title, description, image) so a
    # shared link previews with a title, a description and the Fang-Karte image.
    content = client.get("/").content.decode()
    assert 'property="og:title"' in content
    assert 'property="og:description"' in content
    assert 'property="og:image"' in content
    # The OG image is the Fang-Karte share rendering.
    from django.urls import reverse

    assert reverse("og_fang_karte") in content
    # A site type + canonical URL round out the card.
    assert 'property="og:type"' in content
    assert 'property="og:url"' in content


def test_home_open_graph_image_and_url_are_absolute(client):
    # OG image/url must be absolute (scheme + host) so social scrapers can fetch
    # them — a relative path does not resolve off-site.
    import re

    content = client.get("/").content.decode()
    for prop in ("og:image", "og:url"):
        match = re.search(rf'property="{prop}" content="([^"]+)"', content)
        assert match, f"missing {prop}"
        assert match.group(1).startswith("http"), f"{prop} is not absolute: {match.group(1)}"


def test_home_renders_an_absolute_canonical_link(client):
    # The marketing home renders a real <link rel="canonical"> pointing at the
    # absolute canonical URL of the page — the same value that already feeds
    # og:url (issue #279). Crawlers need the link element, not just the OG tag.
    content = client.get("/").content.decode()
    assert '<link rel="canonical" href="http://testserver/">' in content


def test_home_and_both_funnels_render_hreflang_alternates(client):
    # The bilingual pages — the marketing home and the two lead funnels — each
    # render a full hreflang cluster (de, en, x-default), driven by the same
    # language-switch logic as the DE/EN toggle. x-default resolves to the
    # German apex URL: German is the default language, unprefixed (issue #279).
    for path in ("/", "/zugang-anfragen/", "/gespraech/"):
        content = client.get(path).content.decode()
        de_url = f"http://testserver{path}"
        en_url = f"http://testserver/en{path}"
        assert f'<link rel="alternate" hreflang="de" href="{de_url}">' in content, path
        assert f'<link rel="alternate" hreflang="en" href="{en_url}">' in content, path
        assert f'<link rel="alternate" hreflang="x-default" href="{de_url}">' in content, path


def test_en_variants_render_the_same_cluster_and_are_self_canonical(client):
    # The /en/ variants of the bilingual pages render the SAME alternate
    # cluster as their German counterparts, and each variant is self-canonical
    # — /en/ canonicalises to /en/, never to the German apex (issue #279).
    for path in ("/", "/zugang-anfragen/", "/gespraech/"):
        content = client.get(f"/en{path}").content.decode()
        de_url = f"http://testserver{path}"
        en_url = f"http://testserver/en{path}"
        assert f'<link rel="canonical" href="{en_url}">' in content, path
        assert f'<link rel="alternate" hreflang="de" href="{de_url}">' in content, path
        assert f'<link rel="alternate" hreflang="en" href="{en_url}">' in content, path
        assert f'<link rel="alternate" hreflang="x-default" href="{de_url}">' in content, path


def test_german_only_pages_are_self_canonical_without_alternates(client):
    # The German-only pages — legal (Impressum, Datenschutz, AGB) and the auth
    # flows (Registrierung, Passwort-Reset) — carry a self-referential
    # canonical and NO hreflang alternates: they exist in one language only, so
    # advertising a /en/ alternate would lie to crawlers (issue #279).
    for path in (
        "/impressum/",
        "/datenschutz/",
        "/agb/",
        "/registrierung/",
        "/passwort-zuruecksetzen/",
    ):
        content = client.get(path).content.decode()
        assert f'<link rel="canonical" href="http://testserver{path}">' in content, path
        assert '<link rel="alternate"' not in content, path


def test_home_canonical_equals_the_og_url(client):
    # The canonical link points at the SAME absolute URL the page already feeds
    # og:url (issue #108) — the crawler tag and the share tag never drift apart.
    import re

    content = client.get("/").content.decode()
    canonical = re.search(r'<link rel="canonical" href="([^"]+)">', content)
    og_url = re.search(r'property="og:url" content="([^"]+)"', content)
    assert canonical and og_url
    assert canonical.group(1) == og_url.group(1)


def test_home_carries_a_twitter_summary_large_image_card(client):
    # A Twitter/X card with the large-image layout so the Fang-Karte previews
    # prominently there too.
    content = client.get("/").content.decode()
    assert 'name="twitter:card"' in content
    assert "summary_large_image" in content


def test_home_title_targets_the_beringungssoftware_head_term(client):
    # The marketing home's <title> carries the category head term
    # „Beringungssoftware" — the term a Beringer shopping for a tool actually
    # searches (issue #281) — alongside the brand.
    import re

    content = client.get("/").content.decode()
    title = re.search(r"<title>(.*?)</title>", content, re.DOTALL).group(1)
    assert "Beringungssoftware" in title
    assert "BirdDoc" in title


def test_home_heading_hierarchy_leads_with_beringungssoftware(client):
    # The heading hierarchy leads with the head term (issue #281): the page's
    # H1 opens on „Beringungssoftware", not on the brand tagline.
    import re

    content = client.get("/").content.decode()
    h1 = re.search(r"<h1[^>]*>(.*?)</h1>", content, re.DOTALL).group(1)
    assert h1.strip().startswith("Beringungssoftware")


def test_home_keeps_the_stationsjournal_tagline_in_the_lead(client):
    # The distinctive „Stationsjournal für die Vogelberingung … Schluss mit
    # Papier und Excel" voice survives the head-term retarget as the brand
    # tagline in the hero lead (issue #281) — the term is added, the voice kept.
    import re

    content = client.get("/").content.decode()
    lead = re.search(r'<p class="lead">(.*?)</p>', content, re.DOTALL).group(1)
    assert "Schluss mit Papier und Excel" in lead
    assert "Stationsjournal für die Vogelberingung" in lead


def test_meta_description_and_og_tags_survive_the_head_term_retarget(client):
    # The retarget touches <title> and headings ONLY (issue #281): the meta
    # description and the OG/Twitter titles keep their issue-#108 wording —
    # „Beringungssoftware" does not leak into the share/description tags.
    import re

    content = client.get("/").content.decode()
    description = re.search(r'<meta name="description" content="([^"]+)"', content).group(1)
    assert description.startswith("Schluss mit Papier und Excel: BirdDoc ist das Stationsjournal")
    assert "Beringungssoftware" not in description
    for prop in ('property="og:title"', 'name="twitter:title"'):
        tag = re.search(rf'<meta {prop} content="([^"]+)"', content).group(1)
        assert tag == "BirdDoc: Stationsjournal für die Vogelberingung"


def test_en_home_translates_the_head_term_title_and_h1(client):
    # The /en/ home renders a sensibly translated title and H1 through the
    # existing catalog (issue #281) — the German head term does not leak onto
    # the English page.
    import re

    content = client.get("/en/").content.decode()
    title = re.search(r"<title>(.*?)</title>", content, re.DOTALL).group(1)
    h1 = re.search(r"<h1[^>]*>(.*?)</h1>", content, re.DOTALL).group(1)
    assert "Bird ringing software" in title
    assert h1.strip().startswith("Bird ringing software")
    assert "Beringungssoftware" not in content
