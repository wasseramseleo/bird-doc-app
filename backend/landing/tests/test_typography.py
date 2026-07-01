"""German copy typography guards for the public Landing (issue #116, ADR 0014).

Two render-seam guards protect the Austrian-German house style
(``docs/austrian-german-style.md``):

* the rendered **German** output carries no English em-dash ``—`` (U+2014) — a
  break is written as a spaced en-dash ``–`` or restructured away; and
* the translation catalogs still compile, since there is no compile step in
  CI/Docker and the committed ``.mo`` files are what ship.
"""

from io import StringIO

from django.core.management import call_command

# The full set of German-rendered public pages. The apex home, the German-only
# legal + auth pages, and the two lead forms at their German (apex) URL. A bad
# token deliberately drives the invalid/verify branches so their copy renders
# too. None of these may leak an em-dash into the German output.
GERMAN_PAGES = [
    "/",
    "/impressum/",
    "/datenschutz/",
    "/agb/",
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


def test_translation_catalogs_compile(db):
    # There is no compile step in CI/Docker, so the committed .mo files are what
    # ships. Guard that both catalogs still compile without error.
    out, err = StringIO(), StringIO()
    call_command("compilemessages", locale=["en", "de"], stdout=out, stderr=err)
    assert "error" not in err.getvalue().lower()
