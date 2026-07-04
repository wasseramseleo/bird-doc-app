"""German copy typography guards for the public Landing (issue #116, ADR 0014).

Two render-seam guards protect the Austrian-German house style
(``docs/austrian-german-style.md``):

* the rendered **German** output carries no English em-dash ``—`` (U+2014) — a
  break is written as a spaced en-dash ``–`` or restructured away; and
* the committed ``.mo`` catalogs load, since there is no compile step in
  CI/Docker (the runner has no gettext) and the committed ``.mo`` files are what
  ship.
"""

import gettext
from pathlib import Path

from django.conf import settings

# The full set of German-rendered public pages. The apex home, the German-only
# legal + auth pages, and the two lead forms at their German (apex) URL. A bad
# token deliberately drives the invalid/verify branches so their copy renders
# too. None of these may leak an em-dash into the German output.
GERMAN_PAGES = [
    "/",
    "/impressum/",
    "/datenschutz/",
    "/agb/",
    "/funktionen/",
    "/zugang-anfragen/",
    "/zugang-anfragen/gesendet/",
    "/gespraech/",
    "/gespraech/gesendet/",
    "/registrierung/",
    "/registrierung/gesendet/",
    "/passwort-zuruecksetzen/",
    "/passwort-zuruecksetzen/gesendet/",
    "/passwort-zuruecksetzen/abgeschlossen/",
    "/registrierung/bestaetigen/abc/def/",
    "/einladung/kein-token/",
]

EM_DASH = "—"  # —


def test_no_em_dash_survives_in_rendered_german_pages(client, db):
    for path in GERMAN_PAGES:
        content = client.get(path).content.decode()
        assert EM_DASH not in content, f"em-dash rendered on {path}"


def test_committed_mo_catalogs_load():
    # There is no compile step in CI/Docker (the runner has no gettext), so the
    # committed .mo files are what ships. Guard that each one exists and loads as
    # a valid GNU catalog — via Python's gettext, so no external tools are needed
    # and a malformed/corrupt committed catalog is caught.
    locale_dir = Path(settings.LOCALE_PATHS[0])
    for lang in ("en", "de"):
        mo_path = locale_dir / lang / "LC_MESSAGES" / "django.mo"
        assert mo_path.exists(), f"missing compiled catalog: {mo_path}"
        with mo_path.open("rb") as handle:
            gettext.GNUTranslations(handle)  # raises on a malformed .mo
