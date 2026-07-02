"""Scroll reveals and the orchestrated Fang-Karte hero moment (issue #144).

The landing's single vanilla JS file grows quiet scroll reveals for the page
sections plus exactly ONE orchestrated moment: on arrival the hero Fang-Karte
fills in field by field, ending on the Ringserie ticking to the next number —
die nächste Nummer ist die letzte verbrauchte + 1 (CONTEXT.md: Ringserie),
performed once, in motion.

Strictly a progressive enhancement: the server-rendered DOM ships complete
and visible, every enhancement class is added at runtime, and
prefers-reduced-motion suppresses all of it — the reveals, the moment, and
the coordination with the existing Ringserie load reveal. Per the PRD the JS
behavior itself gets no automated seam (it is verified manually via
Playwright at both viewports during review); these tests pin the
server-rendered contract and the source-level invariants that carry the
enhancement, the same way test_nav_toggle pins the nav script.
"""

import re
from pathlib import Path

STATIC = Path(__file__).resolve().parent.parent / "static" / "landing"


def _script():
    return (STATIC / "nav.js").read_text()


def test_the_landing_script_refuses_all_motion_under_reduced_motion():
    # prefers-reduced-motion disables everything issue #144 adds: the script
    # checks the media query itself and, under `reduce`, never adds a single
    # enhancement class — no reveals, no orchestrated moment, no motion. The
    # nav-toggle enhancement (issue #141) is not motion and must NOT sit
    # behind the gate: the gate appears only after the nav enhancement.
    source = _script()
    gate = 'matchMedia("(prefers-reduced-motion: reduce)")'
    assert gate in source
    assert source.index("site-nav") < source.index(gate)


def test_the_one_orchestrated_moment_fills_the_karte_and_ends_on_the_tick():
    # Exactly one orchestrated moment: the script fills the hero Fang-Karte
    # field by field and ends on the Ringserie ticking to the next number —
    # the next-number promise performed once. To land the thread as the
    # moment's finale it takes OVER the existing CSS load reveal
    # (ringserie--reveal) instead of racing it, and the tick rides the
    # ringserie__next element the server already renders.
    source = _script()
    body = source[source.index('matchMedia("(prefers-reduced-motion: reduce)")') :]
    assert "fang-karte" in body
    assert "ringserie__next" in body
    assert 'classList.remove("ringserie--reveal")' in body
    # One moment, not many: the takeover happens exactly once.
    assert body.count('classList.remove("ringserie--reveal")') == 1


def test_scroll_reveals_ride_an_intersection_observer_and_never_strand_content():
    # The quiet, secondary layer: sections reveal as they scroll into view,
    # driven by an IntersectionObserver. The hiding class (js-reveal) is only
    # ever added right where observing begins — feature-checked, so a browser
    # without the observer never hides a single section. The hero is NOT a
    # scroll-reveal target: it belongs to the orchestrated moment alone.
    source = _script()
    body = source[source.index('matchMedia("(prefers-reduced-motion: reduce)")') :]
    assert "IntersectionObserver" in body
    assert 'classList.add("js-reveal")' in body
    assert body.index("IntersectionObserver") < body.index('classList.add("js-reveal")')
    assert "unobserve" in body


def _no_preference_regions(css):
    """(start, end) index pairs of every no-preference-guarded media block."""
    guard = "@media (prefers-reduced-motion: no-preference)"
    regions = []
    start = css.find(guard)
    while start != -1:
        depth = 0
        i = css.index("{", start)
        j = i
        while True:
            if css[j] == "{":
                depth += 1
            elif css[j] == "}":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        regions.append((start, j))
        start = css.find(guard, j)
    return regions


def test_every_motion_declaration_lives_inside_the_no_preference_guard():
    # Under prefers-reduced-motion there is no motion AT ALL: every
    # transition and animation the stylesheet declares — the Ringserie load
    # reveal and all of issue #144's js-* enhancement states — sits inside a
    # (prefers-reduced-motion: no-preference) guard, so under `reduce` none
    # of it even exists.
    css = (STATIC / "landing.css").read_text()
    regions = _no_preference_regions(css)
    assert regions, "landing.css declares no reduced-motion guard"
    for match in re.finditer(r"transition\s*:|animation\s*:|@keyframes", css):
        assert any(start <= match.start() <= end for start, end in regions), (
            f"motion declaration escapes the reduced-motion guard at index {match.start()}: "
            f"{css[match.start() : match.start() + 60]!r}"
        )
    # The enhancement states issue #144 adds are declared (guarded) states.
    guarded = "".join(css[start:end] for start, end in regions)
    for selector in (".js-reveal", ".js-fill", ".js-stage", ".js-tick"):
        assert selector in guarded, f"{selector} missing from the guarded motion CSS"


def test_without_js_every_section_ships_visible_with_no_enhancement_markup(client):
    # The server-rendered promise: without JavaScript all sections and all
    # content render visible and functional. No js-* enhancement class is
    # ever server-rendered (the script alone adds them at runtime), and
    # nothing on the page ships hidden except the nav toggle button inside
    # the header (issue #141, pinned by test_nav_toggle).
    content = client.get("/").content.decode()
    for class_attr in re.findall(r'class="([^"]*)"', content):
        assert "js-" not in class_attr, f"enhancement class in the server DOM: {class_attr!r}"

    # No element below the header carries the bare `hidden` attribute (the
    # aria-hidden decoration markers are presentation hints, not hiding).
    header_end = content.index("</header>")
    assert not re.search(r"<[^>]*\shidden[\s>]", content[header_end:]), (
        "content below the header ships hidden"
    )

    # Every section of the long scroll is present, server-rendered.
    for anchor in (
        'id="fuer-beringer"',
        'id="fang-formular"',
        'id="excel-vergleich"',
        'id="organisationen"',
        'id="preise"',
    ):
        assert anchor in content
    assert "fang-karte" in content
    assert "ringserie__next" in content
