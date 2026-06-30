"""SEO / Open Graph / share baseline for the public surface (issue #108).

These exercise the apex landing as an unauthenticated visitor — and the crawler
endpoints (`robots.txt`, `sitemap.xml`) and the share image — through the Django
test client, asserting the SEO/OG tags are present and that the crawler files are
served (ADR 0009: the public surface is server-rendered Django).
"""


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


def test_sitemap_xml_is_served(client):
    # /sitemap.xml returns 200 as XML, also at the apex root.
    response = client.get("/sitemap.xml")
    assert response.status_code == 200
    assert "xml" in response["Content-Type"]


def test_sitemap_lists_the_public_pages(client):
    # The sitemap advertises the marketing home and the public lead/legal pages
    # crawlers should index, by their canonical (default-language) URLs.
    from django.urls import reverse

    content = client.get("/sitemap.xml").content.decode()
    for name in ("home", "warteliste", "gespraech", "impressum", "datenschutz", "agb"):
        assert reverse(f"landing:{name}") in content


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


def test_home_carries_a_twitter_summary_large_image_card(client):
    # A Twitter/X card with the large-image layout so the Fang-Karte previews
    # prominently there too.
    content = client.get("/").content.decode()
    assert 'name="twitter:card"' in content
    assert "summary_large_image" in content
