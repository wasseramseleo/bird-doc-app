"""The public Beringungs-Glossar — the field-domain language of the Beringung.

The Glossar defines the craft's vocabulary (Erstfang, Wiederfang, Ringserie, …)
for a public audience, one page per term — not BirdDoc product vocabulary, which
would dilute the reference. Unlike the Ringgrößen-Tabelle and the Artenseiten
(which read the global `Species` reference), a term has no row in any table: the
entries are **repo-versioned editorial content** that ships in this module, gets
reviewed and is tested like code (PRD #300, issue #306).

Served at the apex root outside `i18n_patterns`, deliberately German-only like
the rest of the Wissen reference — one canonical URL per term, no `/en/` variant.
Every page is server-rendered and script-free (ADR 0009): the only `<script>` is
the inert BreadcrumbList JSON-LD, built (with the answer-first lead and the
per-term meta description) from the same `GLOSSAR_ENTRIES` tuple the glossar
sitemap section derives from — so the routable pages and the sitemap can never
drift. The entries carry only field knowledge; no numeric Artennorm value (which
stays signup-gated) is ever published here.
"""

from dataclasses import dataclass
from functools import cached_property

from django.contrib.sitemaps import Sitemap
from django.http import Http404
from django.urls import reverse
from django.views.generic import TemplateView

from .wissen import breadcrumb_context

# The Glossar as a whole — the index page's name and the middle rung of every
# term page's breadcrumb trail.
GLOSSAR_NAME = "Beringungs-Glossar"


@dataclass(frozen=True)
class GlossarEntry:
    """One Beringungs-Glossar term: an answer-first public definition.

    `slug` is the stable public URL; `begriff` leads as the H1; `lead` is the
    answer-first opening sentence (the passage an AI answer engine can lift and
    cite); `absaetze` are the explaining paragraphs; `meta_description` is the
    search/AI snippet. Written fresh for a public audience — CONTEXT.md is the
    source of truth for the *concept*, never the copy text.
    """

    slug: str
    begriff: str
    meta_description: str
    lead: str
    absaetze: tuple[str, ...]


# The first-wave seed terms that exercise the whole path (index → term page →
# sitemap → breadcrumb). The remaining first-wave terms are authored in a
# follow-up; adding one here automatically lists it on the index and in the
# sitemap section (no-drift by construction).
GLOSSAR_ENTRIES: tuple[GlossarEntry, ...] = (
    GlossarEntry(
        slug="erstfang",
        begriff="Erstfang",
        meta_description=(
            "Ein Erstfang ist die erste Fangaufnahme eines wildlebenden Vogels, bei der "
            "ein neuer, eindeutig nummerierter Ring angelegt wird. Definition und "
            "Abgrenzung zum Wiederfang."
        ),
        lead=(
            "Ein Erstfang ist die erste Fangaufnahme eines wildlebenden Vogels, bei der "
            "das Tier zum ersten Mal beringt wird — ein neuer, eindeutig nummerierter "
            "Ring wird angelegt."
        ),
        absaetze=(
            "Jeder Ring wird einem Vogel genau einmal angelegt. Der Erstfang ist damit "
            "der Moment, in dem eine Ringnummer zum ersten und einzigen Mal vergeben "
            "wird: Alter, Geschlecht, Maße und Fundort werden gemeinsam mit der neuen "
            "Ringnummer dokumentiert und bilden den Ausgangspunkt für die gesamte "
            "spätere Lebensgeschichte des Vogels.",
            "Wird derselbe Vogel später erneut gefangen, spricht man von einem "
            "Wiederfang — der vorhandene Ring wird abgelesen, aber kein neuer angelegt. "
            "Aus dem Erstfang und den späteren Wiederfängen lässt sich rekonstruieren, "
            "wie weit ein Vogel zieht, wie alt er wird und wie treu er einem Brutplatz "
            "bleibt.",
            "Beim Erstfang zieht der Beringer die nächste Nummer aus der laufenden "
            "Ringserie. Genau deshalb wird zu einem Ring nur ein einziger Erstfang "
            "erfasst: Ein zweiter Erstfang auf dieselbe Ringnummer wäre ein Widerspruch "
            "und wird als Fehler erkannt.",
        ),
    ),
    GlossarEntry(
        slug="wiederfang",
        begriff="Wiederfang",
        meta_description=(
            "Ein Wiederfang ist der erneute Fang eines bereits beringten Vogels: Der "
            "vorhandene Ring wird abgelesen, kein neuer angelegt. Warum der Wiederfang "
            "das Ziel der Beringung ist."
        ),
        lead=(
            "Ein Wiederfang ist der erneute Fang eines Vogels, der bereits einen Ring "
            "trägt: Der vorhandene Ring wird abgelesen und dokumentiert, aber kein neuer "
            "angelegt."
        ),
        absaetze=(
            "Der Wiederfang ist das eigentliche Ziel der Beringung. Erst wenn ein "
            "beringter Vogel Monate oder Jahre später — am selben Ort oder Hunderte "
            "Kilometer entfernt — noch einmal in der Hand ist, verrät der Vergleich mit "
            "dem Erstfang etwas über Zugweg, Lebensalter und Ortstreue.",
            "Anders als der Erstfang verbraucht ein Wiederfang keine neue Nummer aus der "
            "Ringserie: Der Vogel behält seinen ursprünglichen Ring. Trägt er den Ring "
            "einer anderen Beringungszentrale, werden dessen Nummer und Herkunft "
            "festgehalten, damit die Meldung die richtige Zentrale erreicht.",
            "Ein Vogel kann beliebig oft wiedergefangen werden; jeder Wiederfang ist "
            "eine eigene Fangaufnahme mit eigenem Datum, Ort und Zustand. Gezählt wird "
            "jede Begegnung als eigener Fang, denn jedes Mal wurde ein Vogel tatsächlich "
            "in der Hand untersucht.",
        ),
    ),
    GlossarEntry(
        slug="ringserie",
        begriff="Ringserie",
        meta_description=(
            "Eine Ringserie ist ein fortlaufend nummerierter Satz gleich großer Ringe, "
            "aus dem der Beringer im Feld die nächste Nummer entnimmt. Warum die Nummern "
            "nicht streng aufsteigen."
        ),
        lead=(
            "Eine Ringserie ist ein fortlaufend nummerierter Satz von Ringen einer "
            "einzigen Ringgröße, aus dem der Beringer die Ringe der Reihe nach im Feld "
            "verbraucht."
        ),
        absaetze=(
            "Ringe werden nicht einzeln, sondern als zusammenhängende, aufsteigend "
            "nummerierte Serie ausgegeben — anschaulich eine Schnur gleich großer Ringe. "
            "Für die Feldarbeit werden daraus einzelne Abschnitte herausgetrennt und auf "
            "mehrere Beringer verteilt.",
            "Weil die Abschnitte nicht zwingend in Nummernreihenfolge benutzt werden, "
            "steigen die Ringnummern eines Projekts über die Zeit nicht streng an: Ein "
            "neuerer Fang kann durchaus eine niedrigere Nummer tragen als ein älterer. "
            "Für den nächsten Erstfang wird deshalb die zuletzt verbrauchte Nummer plus "
            "eins vorgeschlagen — nicht einfach die höchste je vergebene.",
            "Ein Wiederfang entnimmt der Serie keine Nummer, ein Erstfang und eine "
            "vernichtete Ringnummer dagegen schon. So bleibt nachvollziehbar, welche "
            "Nummern bereits vergeben sind und welche als nächste an der Reihe ist.",
        ),
    ),
)

# Slug → entry, resolved once at import: the term route is a dictionary lookup,
# and an unknown slug 404s exactly like a slug that never existed.
GLOSSAR_BY_SLUG: dict[str, GlossarEntry] = {entry.slug: entry for entry in GLOSSAR_ENTRIES}


class GlossarIndexView(TemplateView):
    """`/wissen/glossar/` — the Beringungs-Glossar index (issue #306).

    The hub of the section: it describes the glossar and links every term. It
    sits in the Wissen breadcrumb trail and carries its own meta description.
    """

    template_name = "landing/glossar_index.html"

    def get_context_data(self, **kwargs):
        return {
            **super().get_context_data(**kwargs),
            "entries": GLOSSAR_ENTRIES,
            **breadcrumb_context(
                [
                    ("BirdDoc", self.request.build_absolute_uri(reverse("landing:home"))),
                    (GLOSSAR_NAME, self.request.build_absolute_uri(self.request.path)),
                ]
            ),
        }


class GlossarTermView(TemplateView):
    """`/wissen/glossar/<slug>/` — one answer-first page per term (issue #306).

    The `lead` opens the page as a direct definition; the explaining `absaetze`
    follow. An unknown slug 404s. The page carries a per-term meta description
    and a BreadcrumbList JSON-LD trail through the glossar index.
    """

    template_name = "landing/glossar_term.html"

    def get_context_data(self, slug, **kwargs):
        try:
            entry = GLOSSAR_BY_SLUG[slug]
        except KeyError as exc:
            raise Http404("Kein Glossar-Eintrag unter diesem Slug.") from exc
        return {
            **super().get_context_data(**kwargs),
            "entry": entry,
            **breadcrumb_context(
                [
                    ("BirdDoc", self.request.build_absolute_uri(reverse("landing:home"))),
                    (GLOSSAR_NAME, self.request.build_absolute_uri(reverse("wissen_glossar"))),
                    (entry.begriff, self.request.build_absolute_uri(self.request.path)),
                ]
            ),
        }


class GlossarSitemap(Sitemap):
    """The Beringungs-Glossar in sitemap.xml (issue #306).

    Advertises the whole glossar section — the index plus one URL per term —
    derived from the *same* `GLOSSAR_ENTRIES` tuple the pages themselves render
    from, so the sitemap can neither advertise a term that 404s nor miss one
    that exists. Registered alongside the static-pages and Wissen sitemaps in
    `seo.SITEMAPS`; `robots.txt` already points at the one resulting
    sitemap.xml.
    """

    protocol = "https"
    # The editorial glossar changes rarely, like the rest of the reference.
    changefreq = "monthly"

    @cached_property
    def _index_url(self):
        return reverse("wissen_glossar")

    def items(self):
        return [self._index_url] + [
            reverse("wissen_glossar_term", kwargs={"slug": entry.slug}) for entry in GLOSSAR_ENTRIES
        ]

    def location(self, item):
        return item

    def priority(self, item):
        # The index is the hub of the section; the term pages are leaves. Both
        # stay below the Ringgrößen index (the flagship /wissen/ hub).
        return 0.6 if item == self._index_url else 0.5
