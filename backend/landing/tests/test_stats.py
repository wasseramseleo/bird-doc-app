"""The quiet stats row substantiating "An der Station bewährt" (issue #140).

The trust claim gains evidence a reader can weigh: three hand-maintained,
operator-confirmed production figures (3.412 Fänge, 74 Arten, 5 Projekte),
surfaced through the home view's context from module constants — never
live-queried across tenants (ADR 0005 is the tenant boundary; ADR 0012's demo
tenant would poison any live aggregate anyway). Exercised through the Django
test client as an unauthenticated visitor reaches the page. Deliberately no
``django_db`` marker anywhere in this module: pytest-django refuses database
access, so a green run *proves* the row renders from constants alone.
"""

import re

import pytest
from django.utils import translation

from landing.stats import STATION_STATS


@pytest.fixture(autouse=True)
def _restore_active_language():
    # A request to /en/ leaves "en" active on the thread (LocaleMiddleware
    # activates, nothing deactivates), and a later test's bare reverse() would
    # then build /en/ URLs. Restore whatever was active so this module leaks
    # no language state into whichever test pytest-django orders next.
    language = translation.get_language()
    yield
    translation.activate(language)


def _row_values(content):
    return re.findall(r'class="org-stats__value data"[^>]*>([^<]+)<', content)


def _row_labels(content):
    return re.findall(r'class="org-stats__label"[^>]*>([^<]+)<', content)


def test_stats_row_renders_near_the_station_claim_with_the_configured_figures(client):
    # The row sits inside the Für-Organisationen section, right by the
    # "An der Station bewährt" trust beat it substantiates — after the claim,
    # before the section moves on to the Beta-Pilot mention.
    content = client.get("/").content.decode()
    claim = content.index("An der Station bewährt")
    row = content.index('class="org-stats"')
    pilot = content.index("Beta-Pilot")
    assert claim < row < pilot

    # The configured figures render in the German data format with their
    # labels, in the configured order: 3.412 Fänge · 74 Arten · 5 Projekte.
    assert _row_values(content) == ["3.412", "74", "5"]
    assert _row_labels(content) == ["Fänge", "Arten", "Projekte"]


def test_figures_are_hand_maintained_constants_surfaced_through_the_view_context(client):
    # The home view hands the template the module constant itself — the one
    # obvious place a figure is ever updated — and the values are the
    # operator-confirmed production numbers, as plain integers.
    response = client.get("/")
    assert response.context["station_stats"] is STATION_STATS
    assert [stat.value for stat in STATION_STATS] == [3412, 74, 5]


def test_row_carries_accessible_labels_and_the_tabular_data_voice(client):
    # The row is a definition list a screen reader can walk: the group itself
    # is named, and every figure is paired with its term — never a bare number.
    content = client.get("/").content.decode()
    assert re.search(r'<dl class="org-stats" aria-label="[^"]+">', content)
    assert content.count('<dt class="org-stats__label">') == len(STATION_STATS)
    assert content.count('<dd class="org-stats__value data">') == len(STATION_STATS)
    # Every figure rides the page's existing data voice (.data = tabular-nums,
    # the same class the Fang-Karte and Ringserie numbers use).
    assert len(_row_values(content)) == len(STATION_STATS)


def test_stats_labels_translate_under_en_and_grouping_follows_the_locale(client):
    # The row is part of the bilingual marketing surface (issue #107): under
    # /en/ the labels are English and the German ones are gone from the row,
    # while the figures stay the same numbers with English digit grouping.
    en = client.get("/en/").content.decode()
    assert _row_labels(en) == ["Captures", "Species", "Projects"]
    assert _row_values(en) == ["3,412", "74", "5"]
