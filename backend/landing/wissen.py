"""The public /wissen/ reference section — programmatic SEO pages (PRD #278).

The Ringgrößen-Tabelle Österreich lives here rather than in `views.py`: like the
crawler surface in `seo.py`, it is served at the apex *root* (no `i18n_patterns`
prefix) because the reference is deliberately **German-only** for the DACH
audience — there is no `/en/` variant to route. The pages are server-rendered
and script-free (ADR 0009) and read the global `Species` reference table
directly — no new model, no duplication — so the public reference can never
drift from the app's own Austrian list.
"""

import json

from django.urls import reverse
from django.views.generic import TemplateView

from birds.models import Species


class RinggroessenTabelleView(TemplateView):
    """`/wissen/ringgroessen/` — the öffentliche Ringgrößen-Tabelle Österreich.

    One semantic table of every non-Sonderart species with its German name,
    scientific name, family/order and Empfohlene Ringgröße, generated from the
    seeded `Species` reference data (issue #280).
    """

    template_name = "landing/wissen_ringgroessen.html"

    PAGE_NAME = "Ringgrößen-Tabelle Österreich"

    def get_context_data(self, **kwargs):
        breadcrumbs = [
            ("BirdDoc", self.request.build_absolute_uri(reverse("landing:home"))),
            (self.PAGE_NAME, self.request.build_absolute_uri(self.request.path)),
        ]
        return {
            **super().get_context_data(**kwargs),
            # Only real birds: the non-taxon Sonderart rows ("Ring vernichtet",
            # "Aves ignota") are not part of the public reference.
            "species_list": Species.objects.filter(
                special_kind=Species.SpecialKind.NORMAL
            ).order_by("common_name_de"),
            # The visible breadcrumb trail and its BreadcrumbList JSON-LD are
            # built from the same pairs, so the two can never disagree. The
            # JSON is dumped here (not hand-written in the template) so it is
            # parseable by construction.
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
