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


# The first-wave field-domain vocabulary (roughly a dozen terms, issue #313),
# authored on the #306 mechanism that exercises the whole path (index → term
# page → sitemap → breadcrumb). Ordered as a reader would meet them; adding one
# here automatically lists it on the index and in the sitemap section (no-drift
# by construction). Product/tenancy vocabulary is deliberately excluded, and no
# numeric Artennorm value is ever published (it stays signup-gated).
GLOSSAR_ENTRIES: tuple[GlossarEntry, ...] = (
    GlossarEntry(
        slug="beringung",
        begriff="Beringung",
        meta_description=(
            "Beringung ist das wissenschaftliche Markieren wildlebender Vögel mit einem "
            "individuell nummerierten Ring, um Zugwege, Alter und Ortstreue zu erforschen. "
            "Wie sie funktioniert und wer sie durchführt."
        ),
        lead=(
            "Beringung ist das wissenschaftliche Markieren wildlebender Vögel mit einem "
            "individuell nummerierten Ring, um ihre Wege, ihr Alter und ihre Ortstreue "
            "über Jahre hinweg nachvollziehen zu können."
        ),
        absaetze=(
            "Bei der Beringung wird ein Vogel behutsam gefangen, vermessen und mit einem "
            "leichten Ring am Lauf versehen. Jeder Ring trägt eine eindeutige Nummer und "
            "die Adresse einer Beringungszentrale. Wird derselbe Vogel später erneut "
            "gefangen oder tot gefunden, lässt sich über diese Nummer zweifelsfrei "
            "feststellen, welches Individuum man vor sich hat.",
            "So entsteht aus vielen einzelnen Fängen ein Bild von Zugwegen, "
            "Lebenserwartung und Bestandsentwicklung ganzer Arten. Beringung ist damit "
            "eine der ältesten und ergiebigsten Methoden der Vogelforschung — ein großer "
            "Teil unseres Wissens über den Vogelzug stammt aus wiedergefundenen Ringen.",
            "Beringen dürfen nur eigens ausgebildete und behördlich lizenzierte "
            "Beringerinnen und Beringer. Der Tierschutz hat dabei Vorrang: Fang, "
            "Handhabung und Ringgröße folgen festen Regeln, damit die Belastung für den "
            "Vogel so gering wie möglich bleibt und er unmittelbar nach der Aufnahme "
            "wieder freigelassen wird.",
        ),
    ),
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
            "in der Hand untersucht — und erst die Summe dieser Begegnungen macht die "
            "Lebensgeschichte eines beringten Vogels sichtbar.",
        ),
    ),
    GlossarEntry(
        slug="ringgroesse",
        begriff="Ringgröße",
        meta_description=(
            "Die Ringgröße ist die Größenklasse eines Vogelrings als kurzes "
            "Buchstabenkürzel, das zum Laufdurchmesser des Vogels passen muss. Wie die "
            "österreichischen Größencodes funktionieren."
        ),
        lead=(
            "Die Ringgröße ist die Größenklasse eines Vogelrings, angegeben als kurzes "
            "Buchstabenkürzel, das zum Durchmesser des Vogellaufs passen muss — zu eng "
            "schnürt ein, zu weit rutscht ab."
        ),
        absaetze=(
            "Vögel unterscheiden sich enorm in der Stärke ihrer Beine: Ein Zaunkönig "
            "braucht einen winzigen Ring, ein Höckerschwan einen um ein Vielfaches "
            "größeren. Jede Größenklasse deckt eine Spanne von Laufdurchmessern ab, und "
            "für jede Art ist erfahrungsgemäß bekannt, welche Größe in aller Regel passt.",
            "In Österreich sind die Ringgrößen als feste Reihe von Buchstabencodes "
            "festgelegt, die die zuständige Beringungszentrale herausgibt. Ausländische "
            "Zentralen verwenden eigene Größenschemata, sodass derselbe Buchstabe je nach "
            "Land eine andere Größe bezeichnen kann — deshalb gehört zu einer Ringgröße "
            "immer die Angabe, aus welchem Schema sie stammt.",
            "Welche Größe für eine Art empfohlen wird, hält die Artenliste fest; die "
            "endgültige Wahl trifft aber die Beringerin am lebenden Tier. Sitzt der "
            "empfohlene Ring im Einzelfall nicht richtig, wird eine Nummer größer oder "
            "kleiner gewählt — der Sitz am Vogel geht der Tabelle vor.",
        ),
    ),
    GlossarEntry(
        slug="empfohlene-ringgroesse",
        begriff="Empfohlene Ringgröße",
        meta_description=(
            "Die Empfohlene Ringgröße ist der erfahrungsbasierte Standardvorschlag für "
            "die Ringgröße einer Art — ein Richtwert, keine Vorschrift. Warum manche "
            "Arten keine feste Empfehlung haben."
        ),
        lead=(
            "Die Empfohlene Ringgröße ist die Ringgröße, die für eine Art standardmäßig "
            "vorgeschlagen wird — ein erfahrungsbasierter Richtwert, der die passende "
            "Größe schon vor dem Anlegen nahelegt, aber keine feste Vorschrift ist."
        ),
        absaetze=(
            "Für die meisten Arten hat sich über unzählige Beringungen hinweg gezeigt, "
            "welche Größenklasse am besten sitzt. Diese Erfahrung ist in der Artenliste "
            "als Empfehlung hinterlegt, sodass bei der Aufnahme eines Vogels die "
            "voraussichtlich richtige Größe schon vorgeschlagen wird und nicht jedes Mal "
            "neu nachgeschlagen werden muss.",
            "Die Empfehlung bleibt aber ein Vorschlag. Manche Arten haben gar keine "
            "eindeutige Empfehlung — etwa wenn Männchen und Weibchen so unterschiedlich "
            "groß sind, dass beide Geschlechter verschiedene Ringe brauchen. Dann bleibt "
            "die Angabe bewusst offen, statt eine womöglich falsche Größe vorzugeben.",
            "Im Einzelfall entscheidet immer der Vogel. Weicht der Lauf eines Tieres vom "
            "Üblichen ab, wählt die Beringerin eine andere als die empfohlene Größe — die "
            "Empfehlung beschleunigt die Routine, ersetzt aber nie den prüfenden Blick "
            "auf das konkrete Bein.",
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
            "mehrere Beringer verteilt. Jeder Ring der Serie trägt seine eigene, "
            "eindeutige Nummer, sodass später zweifelsfrei feststeht, welcher Vogel "
            "welchen Ring bekommen hat.",
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
    GlossarEntry(
        slug="kuerzel",
        begriff="Kürzel",
        meta_description=(
            "Ein Kürzel ist das kurze Namenszeichen, das eine Beringerin in Aufnahmen und "
            "Meldungen eindeutig benennt. Wie die österreichische Regel aus dem Namen ein "
            "Kürzel bildet."
        ),
        lead=(
            "Ein Kürzel ist das kurze Namenszeichen, mit dem eine Beringerin oder ein "
            "Beringer in Aufnahmen und Meldungen eindeutig benannt wird, ohne den vollen "
            "Namen ausschreiben zu müssen."
        ),
        absaetze=(
            "Bei jedem gefangenen Vogel wird festgehalten, wer ihn beringt oder abgelesen "
            "hat. Weil ein voller Name Platz kostet und sich leicht doppelt, tritt an "
            "seine Stelle ein kompaktes Kürzel — ein knappes, unverwechselbares Zeichen, "
            "das die verantwortliche Person in jedem Datensatz und in jedem Export "
            "benennt.",
            "In Österreich folgt das Kürzel einer einfachen Regel: der erste Buchstabe "
            "des Vornamens, gefolgt von den ersten beiden Buchstaben des Nachnamens. Aus "
            "Filip Reiter wird so das Kürzel FRE. Dadurch lässt sich ein Kürzel meist "
            "ohne Nachschlagen einer Person zuordnen.",
            "Das Kürzel steht für die Verantwortung an einer Aufnahme, nicht für ein "
            "Benutzerkonto. Auch erfahrene Helferinnen und Helfer ohne eigenes Konto "
            "beringen Vögel und werden über ihr Kürzel als handelnde Person geführt — es "
            "benennt, wer am Vogel gearbeitet hat, unabhängig davon, wer die Daten "
            "einträgt.",
        ),
    ),
    GlossarEntry(
        slug="fangmethode",
        begriff="Fangmethode",
        meta_description=(
            "Die Fangmethode beschreibt, wie ein Vogel gefangen wurde — etwa mit dem "
            "Japannetz — als standardisierter Code. Warum sie für den Vergleich von "
            "Beringungsdaten wichtig ist."
        ),
        lead=(
            "Die Fangmethode beschreibt, auf welche Weise ein Vogel gefangen wurde — etwa "
            "mit einem feinmaschigen Japannetz —, festgehalten als standardisierter Code, "
            "der die Fangumstände für die Auswertung vergleichbar macht."
        ),
        absaetze=(
            "Vögel werden auf sehr unterschiedliche Art gefangen: mit nahezu "
            "unsichtbaren Netzen, mit Reusen und Fallen oder direkt am Nest. Für die "
            "spätere Auswertung ist wichtig zu wissen, wie ein Fang zustande kam, denn die "
            "Methode beeinflusst, welche Arten und Altersgruppen überhaupt in die Hand "
            "geraten.",
            "Damit sich Daten über Stationen und Länder hinweg vergleichen lassen, wird "
            "die Fangmethode nicht in Worten, sondern als vereinbarter Buchstabencode "
            "notiert. So bezeichnet derselbe Code europaweit dieselbe Methode, und "
            "Meldungen aus verschiedenen Quellen bleiben eindeutig lesbar.",
            "Die Fangmethode ist in der Regel eine Eigenschaft der gesamten "
            "Fangkampagne und nicht des einzelnen Vogels: An einer Station mit stehenden "
            "Netzen werden über einen Zeitraum viele Vögel auf dieselbe Weise gefangen. "
            "Sie wird deshalb einmal für das Vorhaben festgelegt und gilt für dessen "
            "Fänge.",
        ),
    ),
    GlossarEntry(
        slug="lockmittel",
        begriff="Lockmittel",
        meta_description=(
            "Ein Lockmittel ist jeder Reiz, mit dem Vögel an den Fangplatz gelockt werden "
            "— etwa abgespielte Rufe — festgehalten als Code. Warum auch kein Lockmittel "
            "dokumentiert wird."
        ),
        lead=(
            "Ein Lockmittel ist jeder Reiz, mit dem Vögel gezielt an den Fangplatz "
            "gelockt werden — etwa abgespielte Rufe —, festgehalten als standardisierter "
            "Code, der auch die bewusste Entscheidung gegen jede Lockung dokumentiert."
        ),
        absaetze=(
            "Um bestimmte Arten überhaupt oder in ausreichender Zahl zu fangen, wird der "
            "Fang manchmal unterstützt: durch vorgespielte Lautäußerungen, durch "
            "Klanginstallationen oder andere Reize, die Vögel neugierig machen oder zur "
            "Annäherung veranlassen. Ob und womit gelockt wurde, verändert, welche Vögel "
            "am Netz erscheinen.",
            "Deshalb gehört das Lockmittel zu den festgehaltenen Umständen eines Fangs. "
            "Es wird als vereinbarter Code notiert, damit europaweit eindeutig ist, "
            "welcher Reiz eingesetzt wurde. Auch der Normalfall hat einen eigenen Code: "
            "Wurde gar nicht gelockt, wird ausdrücklich der Code für kein Lockmittel "
            "eingetragen.",
            "Wie die Fangmethode ist das Lockmittel meist eine Eigenschaft des ganzen "
            "Vorhabens und nicht des einzelnen Vogels. Es wird für die Fangkampagne "
            "festgelegt und mit exportiert, sodass sich später nachvollziehen lässt, "
            "unter welchen Bedingungen ein Datensatz entstanden ist.",
        ),
    ),
    GlossarEntry(
        slug="fangtag",
        begriff="Fangtag",
        meta_description=(
            "Ein Fangtag ist ein Kalendertag, an dem an einer Beringungsstelle mindestens "
            "ein Vogel gefangen wurde. Warum Tage ohne Fang keine Fangtage sind und die "
            "Reihe lückenhaft bleibt."
        ),
        lead=(
            "Ein Fangtag ist ein einzelner Kalendertag, an dem an einer "
            "Beringungsstelle mindestens ein Vogel gefangen wurde — die natürliche "
            "Einheit, in der die tägliche Fangleistung zusammengefasst wird."
        ),
        absaetze=(
            "Beringung findet nicht gleichmäßig statt, sondern an einzelnen Tagen mit "
            "Fangbetrieb: Wetter, Jahreszeit und Aufwand entscheiden, ob und wie viel "
            "gefangen wird. Jeder Tag, an dem tatsächlich Vögel in der Hand waren, ist "
            "ein Fangtag und bündelt alles, was an ihm aufgenommen wurde.",
            "Tage ohne einen einzigen Fang sind keine Fangtage. Die Folge der Fangtage "
            "ist deshalb lückenhaft: Sie zählt nur die Tage, an denen wirklich beringt "
            "wurde, und füllt die Lücken dazwischen nicht zu einem durchgehenden Kalender "
            "auf. So spiegelt sie den tatsächlichen Aufwand wider und nicht den Ablauf "
            "des Kalenders.",
            "Als gemeinsame Zeiteinheit macht der Fangtag Zahlen vergleichbar: Wie viele "
            "Vögel und wie viele Arten kamen an einem Tag zusammen, wie entwickeln sich "
            "diese Werte über eine Saison? Auswertungen gruppieren ihre Tageswerte "
            "entlang der Fangtage, weil ein Fangtag einer Einheit an Feldarbeit "
            "entspricht.",
        ),
    ),
    GlossarEntry(
        slug="artennorm-plausibilitaet",
        begriff="Artennorm und Plausibilität",
        meta_description=(
            "Eine Artennorm ist das art-typische Erwartungsprofil, gegen das Messwerte "
            "geprüft werden; fällt ein Wert heraus, warnt eine Plausibilitätswarnung, "
            "ohne die Aufnahme zu blockieren."
        ),
        lead=(
            "Eine Artennorm ist das art-typische Erwartungsprofil, gegen das die "
            "Messwerte eines gefangenen Vogels geprüft werden — weicht ein Wert deutlich "
            "ab, erscheint eine Plausibilitätswarnung, die auf einen möglichen Fehler "
            "aufmerksam macht."
        ),
        absaetze=(
            "Beim Vermessen eines Vogels entstehen viele Zahlen — Gewicht, Flügel- und "
            "Federlänge und weitere Maße. Für viele Arten ist aus großen Datenmengen "
            "bekannt, in welchem Bereich diese Werte üblicherweise liegen. Die Artennorm "
            "fasst dieses Erfahrungswissen je Art zusammen: einen typischen Mittelwert "
            "und eine übliche Streuung für jede geprüfte Größe.",
            "Trägt jemand einen Wert ein, der aus diesem üblichen Bereich fällt, meldet "
            "sich die Plausibilitätswarnung. Sie weist auf die Auffälligkeit hin, "
            "blockiert aber nie: Ein echt ungewöhnlicher Vogel muss aufnehmbar bleiben. "
            "Die Warnung hilft, Zahlendreher und Verwechslungen im Feld zu bemerken, "
            "überlässt die Entscheidung aber der beringenden Person.",
            "Nicht jede Art hat eine Artennorm, und selbst wo es eine gibt, ist jede "
            "einzelne Prüfung eigenständig — sie greift nur dort, wo ein Erwartungswert "
            "hinterlegt ist. Die konkreten Zahlenwerte hinter diesen Prüfungen gehören "
            "zum Innenleben der Software und werden auf den öffentlichen Wissensseiten "
            "bewusst nicht veröffentlicht; hier steht der Begriff, nicht die Tabelle.",
        ),
    ),
    GlossarEntry(
        slug="zentrale",
        begriff="Zentrale",
        meta_description=(
            "Eine Zentrale ist die staatliche Beringungszentrale, unter deren Regeln ein "
            "Ring ausgegeben und gemeldet wird. Warum ausländische Ringe zu ihrer "
            "Zentrale gemeldet werden."
        ),
        lead=(
            "Eine Zentrale ist die staatliche Beringungszentrale, unter deren Regeln ein "
            "Ring ausgegeben und gemeldet wird — sie führt die Ringnummern eines Landes "
            "und ist die Anlaufstelle für jeden Fund eines dort ausgegebenen Rings."
        ),
        absaetze=(
            "Jeder Vogelring gehört zu genau einer Zentrale, deren Adresse in den Ring "
            "eingeprägt ist. Sie vergibt die Ringe an ihre Beringerinnen und Beringer, "
            "verwaltet die zugehörigen Nummernkreise und sammelt die Meldungen über "
            "beringte und wiedergefundene Vögel. In Österreich ist das die "
            "Österreichische Vogelwarte.",
            "Zentralen arbeiten länderübergreifend zusammen, folgen aber jeweils eigenen "
            "Konventionen. Das zeigt sich besonders bei den Ringgrößen: Derselbe "
            "Größenbuchstabe kann bei zwei Zentralen unterschiedliche Größen bezeichnen. "
            "Wird ein Vogel mit ausländischem Ring wiedergefangen, gehört zur Meldung "
            "deshalb immer, von welcher Zentrale der Ring stammt.",
            "Findet jemand einen beringten Vogel, führt die Ringadresse zur richtigen "
            "Zentrale, die den Fund mit dem ursprünglichen Fang zusammenbringt. So "
            "entsteht über Landesgrenzen hinweg ein gemeinsames Bild der "
            "Vogelbewegungen — die Zentrale ordnet einen einzelnen Ring in dieses große "
            "Ganze ein.",
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
