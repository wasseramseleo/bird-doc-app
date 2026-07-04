"""The marketing home's collapsible mobile nav (issue #141).

At narrow viewports the header nav collapses behind a toggle — but only as a
*progressive enhancement* carried by the landing's single, first-party vanilla
JS file. Without JavaScript the server-rendered DOM is the whole story: every
nav link renders fully expanded and the page works unchanged. Anmelden keeps
linking OUT to the SPA login (ADR 0008) and, together with the DE/EN toggle,
stays directly visible at every viewport width — only the section links
collapse. Exercised through the Django test client as an ordinary,
unauthenticated visitor; the visual collapse/expand behavior itself is a
browser concern verified via the PR's Playwright screenshots.
"""

import re

# Just the chrome: the <header>…</header> region of a rendered page.
HEADER = re.compile(r"<header\b.*?</header>", re.DOTALL)


def _header(client, url="/"):
    match = HEADER.search(client.get(url).content.decode())
    assert match, f"{url} rendered no <header>"
    return match.group(0)


def test_all_nav_links_are_server_rendered_regardless_of_javascript(client, settings):
    # The no-JS fallback: every nav link is present in the server-rendered
    # header DOM — the section anchors live in a collapsible group that ships
    # WITHOUT any hidden attribute (fully expanded until JS enhances it), while
    # Anmelden and the DE/EN toggle sit OUTSIDE that group so they stay
    # directly visible even when the sections collapse.
    header = _header(client)

    sections = re.search(r"<div class=\"site-nav__sections\"[^>]*>.*?</div>", header, re.DOTALL)
    assert sections, "the header carries no site-nav__sections group"
    group = sections.group(0)
    assert "hidden" not in group.split(">", 1)[0], "the sections group must not ship hidden"
    for anchor in ("#funktionen", "#organisationen", "#preise"):
        assert anchor in group, f"{anchor} missing from the collapsible sections group"

    outside = header.replace(group, "")
    assert "Anmelden" in outside
    assert settings.APP_LOGIN_URL in outside
    assert "lang-toggle" in outside


def test_nav_toggle_button_ships_hidden_until_javascript_reveals_it(client):
    # The toggle is server-rendered (so the enhancement never injects markup)
    # but ships with the `hidden` attribute: a visitor without JavaScript never
    # sees a dead button. It is wired for accessibility from the start —
    # collapsed state announced, controlling the sections group by id.
    header = _header(client)
    button = re.search(r"<button\b[^>]*site-nav__toggle[^>]*>", header)
    assert button, "the header carries no site-nav__toggle button"
    tag = button.group(0)
    assert "hidden" in tag
    assert 'type="button"' in tag
    assert 'aria-expanded="false"' in tag
    assert 'aria-controls="site-nav-sections"' in tag


def test_home_ships_exactly_one_script_the_landings_own(client):
    # The landing's single light JavaScript file: exactly one EXECUTABLE
    # script on the page, served from the landing's own statics (never a CDN
    # or any third-party host), deferred so it cannot block first paint. No
    # inline executable script rides along — the only other <script> allowed
    # is the inert SoftwareApplication JSON-LD data block (issue #283), which
    # the browser never executes and which triggers no request.
    content = client.get("/").content.decode()
    scripts = re.findall(r"<script\b[^>]*>", content, re.IGNORECASE)
    executable = [tag for tag in scripts if "application/ld+json" not in tag]
    assert len(executable) == 1
    tag = executable[0]
    assert 'src="/static/landing/nav.js"' in tag
    assert "defer" in tag
    assert "//" not in tag  # no protocol-relative or absolute third-party src
    # Every other <script> on the page is a typed JSON-LD data block.
    for data_block in scripts:
        if data_block != tag:
            assert 'type="application/ld+json"' in data_block


def test_nav_script_is_vanilla_and_dependency_free():
    # The file ships in the landing's own statics and is plain vanilla JS:
    # no module imports, no bundler/require, no framework globals, and no URL
    # to anywhere — it can trigger zero third-party (indeed zero further)
    # requests. It maintains the toggle's announced state (aria-expanded),
    # the accessibility contract the server-rendered button opens with.
    from pathlib import Path

    from django.conf import settings

    script = Path(settings.BASE_DIR) / "landing" / "static" / "landing" / "nav.js"
    assert script.is_file(), f"nav.js missing at {script}"
    source = script.read_text()
    for marker in ("import ", "import(", "require(", "http://", "https://", "//cdn", "$("):
        assert marker not in source, f"nav.js must stay dependency-free (found {marker!r})"
    assert "aria-expanded" in source


def test_nav_toggle_label_is_bilingual_like_the_rest_of_the_nav(client):
    # The toggle belongs to the bilingual marketing surface (issue #107):
    # German at the apex, English under /en/.
    de = _header(client, "/")
    en = _header(client, "/en/")
    assert "Menü" in de
    assert "Menu" in en
    assert "Menü" not in en
