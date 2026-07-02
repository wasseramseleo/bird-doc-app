"""The funnel consistency pass — Warteliste + Gespräch forms and confirmations (issue #143).

The funnel endpoint was visibly plainer than the landing that feeds it, leaking
trust at the moment of conversion. Both lead forms ("Zugang anfragen" and
"Gespräch vereinbaren") and their gesendet confirmations adopt the landing's
rhythm language (the full-bleed band vocabulary of issue #142) and the unified
form styling, and each funnel carries one reassurance line about what happens
after submitting. Microcopy + styling hooks only: no new form fields, and the
submission/operator-notification behavior stays pinned by test_warteliste.py.

These tests assert the shared styling HOOKS (body classes, band wrappers, the
panel/eyebrow/button vocabulary), never CSS values — the visual outcome is
verified via Playwright screenshots at desktop and mobile during review.
"""

import pytest
from django.urls import reverse

FUNNEL_PAGES = [
    "landing:warteliste",
    "landing:warteliste_done",
    "landing:gespraech",
    "landing:gespraech_done",
]


def test_warteliste_funnel_reassures_about_the_post_submit_process(client):
    # One quiet line on the form names what happens after submitting: the
    # operator reviews the request, and the Zugangscode follows per E-Mail as
    # soon as a place is free. In German at the apex...
    de = client.get("/zugang-anfragen/").content.decode()
    assert 'class="funnel-next"' in de
    assert "Nach dem Absenden sehen wir uns deine Anfrage an" in de
    assert "Zugangscode" in de
    # ...and in English under /en/ (the funnel is bilingual, issue #107).
    en = client.get("/en/zugang-anfragen/").content.decode()
    assert 'class="funnel-next"' in en
    assert "After you send the form, we review your request" in en
    assert "access code" in en


def test_gespraech_funnel_reassures_about_the_post_submit_process(client):
    # The organisation funnel's line: the operator reviews the request and gets
    # in touch per E-Mail to arrange the Gespräch. In German at the apex...
    de = client.get("/gespraech/").content.decode()
    assert 'class="funnel-next"' in de
    assert "Nach dem Absenden sehen wir uns deine Anfrage an" in de
    assert "Termin" in de
    # ...and in English under /en/.
    en = client.get("/en/gespraech/").content.decode()
    assert 'class="funnel-next"' in en
    assert "After you send the form, we review your request" in en
    assert "arrange the conversation" in en


@pytest.mark.parametrize("name", ["landing:warteliste_done", "landing:gespraech_done"])
def test_confirmations_speak_the_unified_form_vocabulary(client, name):
    # The gesendet pages carry the same field-record voice as the forms that
    # feed them: the mono eyebrow above the heading, and the way back to the
    # marketing home is a full button — the funnel's action vocabulary — not a
    # demoted plain text link.
    content = client.get(reverse(name)).content.decode()
    assert 'class="eyebrow"' in content
    home = reverse("landing:home")
    assert f'class="button" href="{home}"' in content


def test_confirmations_translate_under_en(client):
    # An English lead's funnel must not dead-end in German: the gesendet pages
    # belong to the bilingual lead surface (issue #107), rendering German at
    # the apex and English under /en/ — including the post-submit process copy.
    for slug in ("/zugang-anfragen/gesendet/", "/gespraech/gesendet/"):
        de = client.get(slug).content.decode()
        en = client.get(f"/en{slug}").content.decode()
        assert "Anfrage erhalten" in de
        assert "Request received" in en
        assert "Anfrage erhalten" not in en


def test_en_submission_confirms_in_english(client, db):
    # Submitting the English form keeps the visitor in the English funnel: the
    # redirect lands on the /en/ confirmation, not the German one.
    response = client.post("/en/zugang-anfragen/", {"email": "lead@example.org"})
    assert response.status_code == 302
    assert response.url == "/en/zugang-anfragen/gesendet/"


@pytest.mark.parametrize("name", FUNNEL_PAGES)
def test_funnel_pages_ride_the_landing_page_rhythm(client, name):
    # Every funnel page — both lead forms and both confirmations — wears the
    # marketing surface plus its own funnel marker, and its content card sits
    # inside a full-bleed band re-centred on the measure: the same rhythm
    # vocabulary the marketing home speaks (issue #142), so a lead's trust
    # survives the page transition.
    content = client.get(reverse(name)).content.decode()
    assert '<body class="page--marketing page--funnel">' in content
    assert '<div class="band band--sunk">' in content
    assert '<div class="band__inner">' in content
    # The unified form card (the brass-edged panel) carries the content.
    assert '<div class="panel">' in content
