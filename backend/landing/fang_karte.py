"""The hero's static Fang-Karte specimen (issue #106).

The marketing hero's signature is one ornithologically credible capture record —
true to the product, not a stock mockup. Every value here is a domain fact: the
species is a real Artenliste row, and later slices anchor the ring to the size
the app recommends for THAT species (its Empfohlene Ringgröße) and the Kürzel to
the Austrian standard.

It is a module-level constant, not a per-request DB read: the hero is *static*
(ADR 0009) and renders identically on every request and on an unseeded database.
Credibility is enforced by tests that cross-check this specimen against the
domain (the seeded Species table and ``derive_handle``).
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class FangKarte:
    common_name_de: str
    scientific_name: str
    ring_size: str  # the species' Empfohlene Ringgröße (a Ring.RingSizes code)
    ring_number: str  # the number this capture consumed off the Ringserie rope
    beringer_first: str
    beringer_last: str
    kuerzel: str  # the Austrian standard handle — must equal derive_handle(first, last)
    station: str
    datum: str
    age: str
    sex: str
    wing_mm: str
    weight_g: str
    fat: str
    ringserie: tuple[str, ...]  # consecutive consumed numbers, ending at ring_number
    next_number: str  # the next suggestion: last-consumed + 1 (same width)


# Kohlmeise (Parus major): the textbook Central-European ringing passerine. Its
# Empfohlene Ringgröße in the seeded Species table is "T" (migration 0022), the
# ring carries the last consumed number on the rope, and the Kürzel "FRE" is the
# Austrian standard for Filip Reiter (the canonical example in CONTEXT.md).
FANG_KARTE = FangKarte(
    common_name_de="Kohlmeise",
    scientific_name="Parus major",
    ring_size="T",
    ring_number="0043",
    beringer_first="Filip",
    beringer_last="Reiter",
    kuerzel="FRE",
    station="Linz, Botanischer Garten",
    datum="12.10.2025",
    age="Vorjährig",
    sex="Männlich",
    wing_mm="76",
    weight_g="18,4",
    fat="3",
    # The Ringserie thread is a run of CONSUMED numbers (last-consumed + 1),
    # ending at this capture's number — not a decorative 01/02/03. The next
    # Erstfang of size T would draw 0044 (last consumed + 1), per the rope rule.
    ringserie=("0040", "0041", "0042", "0043"),
    next_number="0044",
)
