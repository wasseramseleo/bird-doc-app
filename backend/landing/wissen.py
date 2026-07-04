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


def art_answer(species):
    """The answer-first sentence of an Artenseite: the Empfohlene Ringgröße.

    States the recommended ring size, or — when the species carries none — the
    honest no-recommendation statement (never a fabricated value, never Python's
    literal ``None``). One plain-text sentence that is BOTH the page's
    answer-first lead and its ``<meta name="description">`` (issue #305), so the
    snippet a search engine or an AI passage-retriever lifts is the exact
    sentence that opens the page — the two can never drift. Only the ring size,
    already public on this page, is stated; the numeric Artennorm (PRD #245)
    stays gated behind signup and is never rendered here.
    """
    if species.ring_size:
        return (
            f"Für die Art {species.common_name_de} ({species.scientific_name}) "
            f"empfiehlt die österreichische Artenliste die Ringgröße "
            f"{species.ring_size}."
        )
    return (
        f"Für die Art {species.common_name_de} ({species.scientific_name}) gibt "
        f"es in der österreichischen Artenliste keine Standard-Empfehlung für "
        f"die Ringgröße."
    )


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


class WissenHubView(TemplateView):
    """`/wissen/` — the index hub of the Wissen reference (issue #314).

    The front door of the whole reference: it describes what Wissen contains and
    links its sections — the Ringgrößen-Tabelle (#280), the Artenseiten (#282)
    and the Beringungs-Glossar (#306) — so a reader and a machine reader can
    grasp and link the section as a whole (PRD #300, user story 10). German-only
    and server-rendered like the rest of the reference (ADR 0009): it sits at the
    top of the Wissen breadcrumb trail and joins the sitemap.

    The Artenseiten have no dedicated index of their own — the Ringgrößen-Tabelle
    is their list — so the hub links a *representative* Artseite, derived from the
    same `Species` reference (and the same slug rule) as the table itself, so the
    example can never drift to a page that 404s.
    """

    template_name = "landing/wissen_index.html"

    PAGE_NAME = "Wissen"

    # Answer-first <meta name="description"> (PRD #300, story 8/10): states what
    # the reference contains — the ring-size reference, the per-species pages and
    # the field-vocabulary glossar — so the snippet is useful and a machine
    # reader can grasp the section as a whole.
    META_DESCRIPTION = (
        "Die Wissen-Referenz von BirdDoc bündelt die öffentliche Beringungs-"
        "Referenz für Österreich: die Ringgrößen-Tabelle mit der Empfohlenen "
        "Ringgröße jeder Art, eine Artenseite je Art und das Beringungs-Glossar "
        "mit den Fachbegriffen der Vogelberingung."
    )

    def get_context_data(self, **kwargs):
        example_species = (
            Species.objects.filter(special_kind=Species.SpecialKind.NORMAL)
            .order_by("common_name_de")
            .first()
        )
        example_art_url = (
            reverse("wissen_art", kwargs={"slug": art_slug(example_species)})
            if example_species is not None
            else None
        )
        return {
            **super().get_context_data(**kwargs),
            "meta_description": self.META_DESCRIPTION,
            "example_species": example_species,
            "example_art_url": example_art_url,
            **breadcrumb_context(
                [
                    ("BirdDoc", self.request.build_absolute_uri(reverse("landing:home"))),
                    (self.PAGE_NAME, self.request.build_absolute_uri(self.request.path)),
                ]
            ),
        }


class WissenReferenceSitemap(Sitemap):
    """The /wissen/ reference in sitemap.xml (issue #284, #314).

    Advertises the whole programmatic reference so the crawler discovers the
    section, not just the marketing pages: the /wissen/ index hub (#314), the
    Ringgrößen index and one URL per non-Sonderart species page. The hub and the
    Ringgrößen index are reversed from their routes; the species pages are
    derived from the same `Species` reference data (and the same slug rule) as
    the pages themselves — so the sitemap can never advertise a page that 404s or
    miss one that exists. Registered alongside the static-pages sitemap in
    `seo.SITEMAPS`; `robots.txt` already points at the one resulting sitemap.xml.
    """

    protocol = "https"
    # The species reference data changes rarely.
    changefreq = "monthly"

    @cached_property
    def _hub_url(self):
        return reverse("wissen_index")

    @cached_property
    def _index_url(self):
        return reverse("wissen_ringgroessen")

    def items(self):
        return [self._hub_url, self._index_url] + [
            reverse("wissen_art", kwargs={"slug": art_slug(species)})
            for species in Species.objects.filter(special_kind=Species.SpecialKind.NORMAL).order_by(
                "common_name_de"
            )
        ]

    def location(self, item):
        return item

    def priority(self, item):
        # The hub is the front door of the whole reference; the Ringgrößen index
        # is the hub of the section below it; the species pages are leaves.
        if item == self._hub_url:
            return 0.8
        return 0.7 if item == self._index_url else 0.5


class RinggroessenTabelleView(TemplateView):
    """`/wissen/ringgroessen/` — the öffentliche Ringgrößen-Tabelle Österreich.

    One semantic table of every non-Sonderart species with its German name,
    scientific name, family/order and Empfohlene Ringgröße, generated from the
    seeded `Species` reference data (issue #280).
    """

    template_name = "landing/wissen_ringgroessen.html"

    PAGE_NAME = "Ringgrößen-Tabelle Österreich"

    # Answer-first <meta name="description"> (issue #305): states what the page
    # answers — the Empfohlene Ringgröße of every Art — so the search snippet is
    # useful and an AI retriever can lift the page's purpose.
    META_DESCRIPTION = (
        "Die Ringgrößen-Tabelle Österreich nennt die Empfohlene Ringgröße für "
        "jede Art der österreichischen Artenliste — mit deutschem Namen, "
        "wissenschaftlichem Namen, Familie und Ordnung, direkt aus der "
        "Artenliste, mit der BirdDoc bei der Beringung arbeitet."
    )

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
            "meta_description": self.META_DESCRIPTION,
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
            # The answer-first lead and the <meta description> share this exact
            # sentence (issue #305), so the on-page answer and the search
            # snippet can never drift.
            "meta_description": art_answer(species),
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
