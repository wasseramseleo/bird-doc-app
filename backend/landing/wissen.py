"""The public /wissen/ reference section — programmatic SEO pages (PRD #278).

The Ringgrößen-Tabelle Österreich (#280) and the per-species Artenseiten (#282)
live here rather than in `views.py`: like the crawler surface in `seo.py`, they
are served at the apex *root* (no `i18n_patterns` prefix) because the reference
is deliberately **German-only** for the DACH audience — there is no `/en/`
variant to route. The pages are server-rendered and script-free (ADR 0009) and
read the global `Species` reference table directly — no new model, no
duplication — so the public reference can never drift from the app's own
Austrian list. The Artenseiten never render Artennorm values: the norms
(PRD #245) stay gated behind the signup wall; the page carries prose only.
"""

import json
from functools import cached_property

from django.contrib.sitemaps import Sitemap
from django.http import Http404
from django.urls import reverse
from django.utils.text import slugify
from django.views.generic import TemplateView

from birds.models import Species


def art_slug(species):
    """The stable public URL slug of a species: its slugified scientific name.

    Scientific names are unique, umlaut-free and survive revisions of the
    German common names, so rankings accrue to a URL that never changes. No
    slug column, no schema change — the slug is derived on the fly (#282).
    """
    return slugify(species.scientific_name)


def breadcrumb_context(breadcrumbs):
    """Context for a breadcrumb trail of `(name, absolute_url)` pairs.

    The visible trail and its BreadcrumbList JSON-LD are built from the same
    pairs, so the two can never disagree. The JSON is dumped here (not
    hand-written in a template) so it is parseable by construction.
    """
    return {
        "breadcrumbs": breadcrumbs,
        "breadcrumb_jsonld": json.dumps(
            {
                "@context": "https://schema.org",
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {
                        "@type": "ListItem",
                        "position": position,
                        "name": name,
                        "item": item,
                    }
                    for position, (name, item) in enumerate(breadcrumbs, start=1)
                ],
            },
            ensure_ascii=False,
        ),
    }


class WissenReferenceSitemap(Sitemap):
    """The /wissen/ reference in sitemap.xml (issue #284).

    Advertises the whole programmatic reference so the crawler discovers the
    section, not just the marketing pages: the Ringgrößen index plus one URL
    per non-Sonderart species page, derived from the same `Species` reference
    data (and the same slug rule) as the pages themselves — so the sitemap can
    never advertise a page that 404s or miss one that exists. Registered
    alongside the static-pages sitemap in `seo.SITEMAPS`; `robots.txt` already
    points at the one resulting sitemap.xml.
    """

    protocol = "https"
    # The species reference data changes rarely.
    changefreq = "monthly"

    @cached_property
    def _index_url(self):
        return reverse("wissen_ringgroessen")

    def items(self):
        return [self._index_url] + [
            reverse("wissen_art", kwargs={"slug": art_slug(species)})
            for species in Species.objects.filter(special_kind=Species.SpecialKind.NORMAL).order_by(
                "common_name_de"
            )
        ]

    def location(self, item):
        return item

    def priority(self, item):
        # The index is the hub of the section; the species pages are leaves.
        return 0.7 if item == self._index_url else 0.5


class RinggroessenTabelleView(TemplateView):
    """`/wissen/ringgroessen/` — the öffentliche Ringgrößen-Tabelle Österreich.

    One semantic table of every non-Sonderart species with its German name,
    scientific name, family/order and Empfohlene Ringgröße, generated from the
    seeded `Species` reference data (issue #280).
    """

    template_name = "landing/wissen_ringgroessen.html"

    PAGE_NAME = "Ringgrößen-Tabelle Österreich"

    def get_context_data(self, **kwargs):
        # Only real birds: the non-taxon Sonderart rows ("Ring vernichtet",
        # "Aves ignota") are not part of the public reference. Each row carries
        # its derived URL slug so the table can link through to the Artenseiten
        # (issue #282) without a slug column.
        species_list = list(
            Species.objects.filter(special_kind=Species.SpecialKind.NORMAL).order_by(
                "common_name_de"
            )
        )
        for species in species_list:
            species.art_slug = art_slug(species)
        return {
            **super().get_context_data(**kwargs),
            "species_list": species_list,
            **breadcrumb_context(
                [
                    ("BirdDoc", self.request.build_absolute_uri(reverse("landing:home"))),
                    (self.PAGE_NAME, self.request.build_absolute_uri(self.request.path)),
                ]
            ),
        }


class ArtSeiteView(TemplateView):
    """`/wissen/art/<slug>/` — one public page per Art (issue #282).

    Answers the search „Ringgröße <Art>": the German common name leads as H1
    while the URL stays on the stable scientific slug. Sonderart rows are not
    birds and get no page — their slugs (like any unknown slug) 404.
    """

    template_name = "landing/wissen_art.html"

    def get_context_data(self, slug, **kwargs):
        species = self._species_for_slug(slug)
        return {
            **super().get_context_data(**kwargs),
            "species": species,
            **breadcrumb_context(
                [
                    ("BirdDoc", self.request.build_absolute_uri(reverse("landing:home"))),
                    (
                        RinggroessenTabelleView.PAGE_NAME,
                        self.request.build_absolute_uri(reverse("wissen_ringgroessen")),
                    ),
                    (
                        species.common_name_de,
                        self.request.build_absolute_uri(self.request.path),
                    ),
                ]
            ),
        }

    @staticmethod
    def _species_for_slug(slug):
        # The slug is resolved by matching against the slugified scientific
        # names of the non-Sonderart species — a small map derived per request
        # from the same reference data as the index, so the two never drift.
        for species in Species.objects.filter(special_kind=Species.SpecialKind.NORMAL):
            if art_slug(species) == slug:
                return species
        raise Http404("Keine Art unter diesem Slug.")
