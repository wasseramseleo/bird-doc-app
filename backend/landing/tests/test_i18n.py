"""Bilingual DE/EN on the marketing surface (issue #107, ADR 0009).

The marketing home and the two lead forms are bilingual via Django
``i18n_patterns`` + ``LocaleMiddleware``: German is the default at the apex
(``/``) with no geo-routing, and English lives under an ``/en/`` prefix. The
legal pages and the auth flows stay German regardless of the prefix — Austrian
law, and the app is ``de-AT``. Exercised through the Django test client as an
ordinary, unauthenticated visitor would reach it — no DRF, no SPA, no login.
"""


def test_apex_and_en_prefix_both_resolve_on_the_home(client):
    # i18n_patterns is wired up: the apex serves the home with no language
    # prefix, and the same home is reachable under an /en/ prefix.
    assert client.get("/").status_code == 200
    assert client.get("/en/").status_code == 200


def test_home_hero_switches_between_german_and_english(client):
    # The shared hero thesis renders German at the apex and English under /en/.
    de = client.get("/").content.decode()
    en = client.get("/en/").content.decode()
    # German at the apex (the default language, no prefix)...
    assert "Schluss mit Papier und Excel" in de
    # ...and the English thesis under /en/, with the German gone from that page.
    assert "Done with paper and Excel" in en
    assert "Schluss mit Papier und Excel" not in en


def test_apex_defaults_to_german_with_no_geo_or_header_routing(client):
    # The apex defaults to German with no geo-routing: even a browser that asks
    # for English (Accept-Language) gets German at `/` — the language is decided
    # by the URL prefix alone, not by who is asking. English is reached only by
    # an explicit choice (the /en/ prefix or the toggle).
    en_browser = client.get("/", HTTP_ACCEPT_LANGUAGE="en-US,en;q=0.9").content.decode()
    assert "Schluss mit Papier und Excel" in en_browser
    assert "Done with paper and Excel" not in en_browser


def test_home_nav_and_both_tracks_switch_language(client):
    # Both audience tracks and the top nav flip with the language — the whole
    # marketing home is bilingual, not just the hero (issue #107 covers both
    # tracks).
    de = client.get("/").content.decode()
    en = client.get("/en/").content.decode()
    # Top nav.
    assert "Funktionen" in de and "Features" in en
    assert "Anmelden" in de and "Sign in" in en
    # Für-Beringer track.
    assert "Vom Zettel zur Fang-Karte" in de
    assert "From the notepad to the capture card" in en
    # Für-Organisationen track — including the track heading itself, which is the
    # one string that must not be left untranslated under /en/.
    assert "Für Organisationen &amp; Vogelwarten" in de
    assert "For organisations &amp; ringing centres" in en
    assert "Für Organisationen &amp; Vogelwarten" not in en
    assert "Datenhoheit" in de and "Data sovereignty" in en
    assert "Kein Lock-in" in de and "No lock-in" in en
    # The English page is genuinely English — the German track headings are gone.
    assert "Vom Zettel zur Fang-Karte" not in en
    assert "Datenhoheit" not in en


def test_en_marketing_carries_the_honest_app_is_german_only_note(client):
    # The EN marketing surface carries one honest line that the app itself is
    # currently German-only; the German surface does not need it.
    de = client.get("/").content.decode()
    en = client.get("/en/").content.decode()
    assert "currently available in German only" in en
    assert "currently available in German only" not in de


def test_warteliste_form_switches_between_german_and_english(client):
    # The Beringer lead form is bilingual: German at /zugang-anfragen/, English
    # under /en/, including the form's field labels.
    de = client.get("/zugang-anfragen/").content.decode()
    en = client.get("/en/zugang-anfragen/").content.decode()
    assert "Zugang anfragen" in de
    assert "Request access" in en
    assert "Zugang anfragen" not in en
    # The field label translates too (it comes from the form, not the template)...
    assert "Email" in en
    # ...and the EN lead surface carries the honest German-only note.
    assert "currently available in German only" in en
    assert "currently available in German only" not in de


def test_gespraech_form_switches_between_german_and_english(client):
    # The organisation lead form is bilingual the same way.
    de = client.get("/gespraech/").content.decode()
    en = client.get("/en/gespraech/").content.decode()
    assert "Gespräch vereinbaren" in de
    assert "Arrange a conversation" in en
    assert "Gespräch vereinbaren" not in en
    assert "currently available in German only" in en


def test_home_carries_a_working_de_en_toggle(client):
    # The header toggle is a real switch: on the German apex it links to the
    # English page, and on the English page back to the German apex — the same
    # page in the other language (no geo-routing, no landing back on the home).
    de = client.get("/").content.decode()
    en = client.get("/en/").content.decode()
    assert 'class="lang-toggle__other" href="/en/"' in de
    assert 'class="lang-toggle__other" href="/"' in en


def test_lead_forms_carry_the_toggle_to_their_own_counterpart(client):
    # The toggle on a lead form switches THAT page's language — it stays on the
    # same form rather than bouncing to the home.
    en_warteliste = client.get("/en/zugang-anfragen/").content.decode()
    en_gespraech = client.get("/en/gespraech/").content.decode()
    assert 'class="lang-toggle__other" href="/zugang-anfragen/"' in en_warteliste
    assert 'class="lang-toggle__other" href="/gespraech/"' in en_gespraech


def test_legal_pages_stay_german_under_an_en_prefix(client):
    # Legal pages render German regardless of the language prefix — Austrian law,
    # and the app is de-AT (issue #107). The /en/ prefix resolves but does not
    # translate them: the body is the same German text as at the apex.
    for slug, marker in [
        ("impressum", "Einzelunternehmen"),
        ("datenschutz", "Auftragsverarbeiter"),
        ("agb", "Auftragsverarbeitung"),
    ]:
        de = client.get(f"/{slug}/")
        en = client.get(f"/en/{slug}/")
        assert de.status_code == 200
        assert en.status_code == 200
        assert marker in en.content.decode()
        # The English prefix did not flip the legal text to English marketing.
        assert "Done with paper and Excel" not in en.content.decode()


def test_auth_pages_stay_german_under_an_en_prefix(client, db):
    # The auth flows stay German regardless of the prefix: the GermanAuthFormMixin
    # forces the German catalog even under /en/. The email label is the tell — it
    # is translated to "Email" on the bilingual lead forms, but stays "E-Mail" on
    # the registration form because that page is pinned to German.
    en_register = client.get("/en/registrierung/")
    assert en_register.status_code == 200
    content = en_register.content.decode()
    assert "E-Mail" in content
    # The German destination chrome is intact (a back affordance, not the
    # English marketing nav).
    assert "Zurück" in content
    assert "Sign in" not in content

    # The password-reset request page is German under /en/ as well.
    en_reset = client.get("/en/passwort-zuruecksetzen/")
    assert en_reset.status_code == 200
    assert "Zurück" in en_reset.content.decode()
