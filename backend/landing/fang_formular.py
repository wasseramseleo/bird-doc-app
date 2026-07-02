"""The product-proof section's static Formular specimen (issue #139).

The landing never showed the actual product, so a visitor signed up for an app
they had never seen. This specimen fills the app's real German data-entry form
as it stands at the Ringtisch — the imagery layer of the product-proof section,
narratively linked to the hero: the form at the Ringtisch becomes the clean
Fang-Karte record.

Like the hero's ``FANG_KARTE`` it is a frozen module-level constant, not a
per-request DB read: the section is *static* (ADR 0009) and renders identically
on every request and on an unseeded database. Its content is shaped like
Referenzprojekt (BDDEMO) captures — plausible, non-real ringing data from the
fictional Illmitz reed-bed cast (ADR 0012: the demo captures are explicitly
*not Fangdaten*, and none of the reality-linking markers of a real capture row
render). Credibility is enforced by tests that cross-check this specimen
against the demo cast, ``derive_handle`` and the seeded Species table.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class FangFormular:
    projekt: str  # the Referenzprojekt-shaped campaign the capture belongs to
    station: str  # the fictional demo reed-bed Station
    beringer_first: str
    beringer_last: str
    kuerzel: str  # the Austrian standard handle — must equal derive_handle(first, last)
    datum: str
    uhrzeit: str
    common_name_de: str
    scientific_name: str
    status: str  # the app's Status select label (Erstfang/Wiederfang)
    ring_size: str  # the species' Empfohlene Ringgröße (a Ring.RingSizes code)
    ring_number: str  # a number inside the demo Ringserie range for that size
    age: str  # the app's coded Alter select label
    sex: str  # the app's coded Geschlecht select label
    fat: str
    muscle: str
    wing_mm: str
    weight_g: str


# Teichrohrsänger (Acrocephalus scirpaceus): the signature species of the
# Referenzprojekt's reed-bed operation at Illmitz / Neusiedlersee. Its
# Empfohlene Ringgröße in the seeded Species table is "V" (migration 0022),
# the ring number sits in the demo V-Ringserie range, and the Beringer is the
# fictional demo cast's Johanna Gruber (Kürzel JGR, the Austrian standard).
# The Alter/Geschlecht values are the app's own coded select labels: an autumn
# diesjährig bird of a non-dimorphic species, sex unbestimmt.
FANG_FORMULAR = FangFormular(
    projekt="Schilf-Monitoring Neusiedlersee",
    station="Illmitz Schilfgürtel",
    beringer_first="Johanna",
    beringer_last="Gruber",
    kuerzel="JGR",
    datum="28.08.2025",
    uhrzeit="06:40",
    common_name_de="Teichrohrsänger",
    scientific_name="Acrocephalus scirpaceus",
    status="Erstfang (e)",
    ring_size="V",
    ring_number="18127",
    age="3 – Diesjährig",
    sex="0 – Unbekannt",
    fat="2",
    muscle="2",
    wing_mm="66",
    weight_g="11,8",
)
