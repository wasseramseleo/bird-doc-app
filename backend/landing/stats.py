"""Hand-maintained production figures for the marketing home (issue #140).

The "An der Station bewährt" trust beat needs evidence a reader can weigh, so
the home renders a quiet stats row of three operator-confirmed figures. They
are module-level constants — THE one obvious place to update them — surfaced
through the home view's context, deliberately never computed from live data:
every queryset is tenant-scoped (ADR 0005), so a cross-tenant aggregate has no
home in the model, and it would count the BDDEMO demo tenant as real ringing
(ADR 0012). Updating a figure is a copy edit here, not a data read.

Labels are lazily translated: German is the source language and the row is part
of the bilingual marketing surface (issue #107, ADR 0009), so the labels flip
under /en/ while the figures stay the same operator-confirmed numbers (their
digit grouping follows the locale at render time).
"""

from dataclasses import dataclass

from django.utils.translation import gettext_lazy as _


@dataclass(frozen=True)
class StationStat:
    value: int  # rendered locale-aware: 3.412 at the German apex, 3,412 under /en/
    label: str  # translatable label (a lazy proxy until render)


STATION_STATS = (
    StationStat(value=3412, label=_("Fänge")),
    StationStat(value=74, label=_("Arten")),
    StationStat(value=5, label=_("Projekte")),
)
