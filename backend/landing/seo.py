"""Crawler & share-baseline surface for the public landing (issue #108).

`robots.txt`, `sitemap.xml` and the Open-Graph share image live here rather than
in `views.py`: they are language-independent infrastructure served at the apex
*root* (no `i18n_patterns` prefix), distinct from the bilingual marketing/auth
pages. The share image is a server-rendered SVG of the same `FANG_KARTE`
specimen the hero draws (ADR 0009: server-rendered Django, no build pipeline) —
so the shared link previews with the product's own credible capture card.
"""

from django.contrib.sitemaps import Sitemap
from django.contrib.staticfiles import finders
from django.http import FileResponse, Http404
from django.urls import reverse
from django.views import View
from django.views.generic import TemplateView

from .fang_karte import FANG_KARTE
from .wissen import WissenReferenceSitemap


class StaticViewSitemap(Sitemap):
    """The public, indexable pages of the marketing + trust surface.

    A static set of named routes — the marketing home, the two lead funnels and
    the legal pages — reversed to their canonical (default-language, apex) URLs.
    The transactional token flows (registration, password reset, invitation
    accept) are deliberately left out: they are reached by mailed links, not
    crawled."""

    protocol = "https"
    changefreq = "monthly"

    def items(self):
        return [
            "landing:home",
            "landing:warteliste",
            "landing:gespraech",
            "landing:impressum",
            "landing:datenschutz",
            "landing:agb",
        ]

    def location(self, item):
        return reverse(item)

    def priority(self, item):
        # The marketing home is the entry point; the rest are secondary.
        return 1.0 if item == "landing:home" else 0.5


# The static marketing/trust pages plus the /wissen/ species reference
# (issue #284) — both sections render into the ONE sitemap.xml that
# robots.txt already advertises.
SITEMAPS = {"static": StaticViewSitemap, "wissen": WissenReferenceSitemap}


class RobotsTxtView(TemplateView):
    """Serve /robots.txt as plain text, pointing crawlers at the sitemap."""

    template_name = "landing/robots.txt"
    content_type = "text/plain"

    def get_context_data(self, **kwargs):
        return {
            **super().get_context_data(**kwargs),
            "sitemap_url": self.request.build_absolute_uri(reverse("sitemap")),
        }


class FaviconView(View):
    """Serve /favicon.ico from the landing's own static assets (issue #137).

    The icon is derived from the existing BirdDoc brand asset and shipped in
    ``landing/static/landing/`` — self-hosted, no third-party request. Serving
    it through a view at the apex root (rather than only a ``/static/…`` link)
    gives it one canonical, prefix-free URL and keeps the classic blind
    ``/favicon.ico`` probe from 404ing."""

    def get(self, request):
        path = finders.find("landing/favicon.ico")
        if path is None:  # pragma: no cover — the asset ships in the repo
            raise Http404("favicon.ico is not in the landing static assets")
        return FileResponse(open(path, "rb"), content_type="image/x-icon")


class FangKarteOgImageView(TemplateView):
    """Render the hero Fang-Karte as the Open-Graph / share image (issue #108).

    A server-rendered SVG built from the *same* `FANG_KARTE` specimen the hero
    draws — so a shared BirdDoc link previews with the product's own credible
    capture card, not a stock mockup, and the share image can never drift from
    the hero (ADR 0009: server-rendered Django, no build pipeline, no raster
    asset to keep in sync). SVG keeps it dependency-free — no Pillow/cairo."""

    template_name = "landing/og_fang_karte.svg"
    content_type = "image/svg+xml"

    def get_context_data(self, **kwargs):
        return {**super().get_context_data(**kwargs), "fang_karte": FANG_KARTE}
