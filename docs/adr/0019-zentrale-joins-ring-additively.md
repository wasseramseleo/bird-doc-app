---
status: accepted
---

# Zentrale joins the Ring additively; Organisation stays the tenant boundary

Extends [ADR 0006](0006-ring-scoped-to-organisation.md).

## Context

[ADR 0006](0006-ring-scoped-to-organisation.md) scoped `Ring` uniqueness to
`(Organisation, Größe, Nummer)` and explicitly left a EURING-scheme dimension as
"the additive future step … if cross-scheme ring identity is ever needed." That
step is now needed: **ausländische Wiederfänge** (foreign recaptures) carry rings
issued under other countries' EURING schemes, whose size-letter codes differ per
scheme (an Austrian "V" is a Slovak "S"), and the IWM export's **Ring** column
must name the **Zentrale** of the ring's original Beringung — today it hardcodes
`AUW`. Without a modelled Zentrale a Slovak `S 1234` is indistinguishable from an
Austrian `S 1234`, and the new export would no longer round-trip through the IWM
import.

A **Zentrale** is exactly one EURING ringing scheme (AUW = Österreichische
Vogelwarte; Germany has three), seeded once as global reference data like
`Species` — never tenant-scoped.

## Decision

Add the **Zentrale** to the Ring **additively**:

- `Ring` gains a `central` FK (the model is code-named `Central`; the domain term
  is **Zentrale**). A migration backfills every existing Ring to AUW.
- `Ring.organisation` **stays** — it remains the **tenant-isolation boundary** of
  ADR 0006, not a domain error to be replaced.
- Ring uniqueness becomes **`(Organisation, Zentrale, Größe, Nummer)`**.
- `Projekt` likewise carries its Zentrale (default AUW), so an Erstfang inherits
  the Projekt-Zentrale.

The Zentrale is **reference data a Ring points at**, not a tenant tier above the
Organisation: the national ringing authority is finally modelled without becoming
a parent-of-Organisations. Organisation and Zentrale are orthogonal — the first
isolates tenants, the second names the issuing scheme.

## Considered options

- **Enforce the Zentrale's real-world global namespace across tenants** — i.e.
  make `(Zentrale, Größe, Nummer)` unique across *all* Organisations, mirroring
  the fact that a physical ring number is globally unique within a scheme.
  **Rejected.** It re-couples tenants exactly as the pre-0006 global constraint
  did, and the coupling would bite in production:
  - **Referenzprojekt / demo-tenant squatting**: the demo tenant (or any test
    Organisation) recording a plausible number would permanently reserve a real
    ring, which the true owner could then never enter.
  - **Unfixable cross-tenant typo collisions**: a mistyped number in one
    Organisation would block a *different* Organisation from recording its
    legitimate ring — and neither tenant can see or correct the other's data
    (they are isolated by ADR 0005), so the wall is undiagnosable and
    unresolvable from either side.
  - **Ring production errors**: schemes do occasionally issue duplicate physical
    numbers; a global constraint would make BirdDoc reject reality and refuse a
    ring that genuinely exists.
- **Keep the Ring single-scheme (status quo).** Rejected: foreign Wiederfänge
  cannot be recorded faithfully and the IWM export cannot round-trip.

## Consequences

- Per-tenant isolation is preserved: each Organisation still owns its Ring rows,
  and the same physical foreign ring is not unified across Organisations —
  captures need only the number that was read (ADR 0006).
- `next-number` and orphaned-Ring cleanup keep working within an Organisation;
  the suggestion counts only Erstfang/Ring-vernichtet entries, which always carry
  the Projekt-Zentrale, so it never sees a foreign size.
- Ringgröße validation becomes conditional on the ring's Zentrale — AUW's 28
  codes stay a fixed choice, any other Zentrale falls back to trimmed, uppercased,
  length-capped, never-empty free text.
- **Numbering note**: `docs/adr/` tops out at 0018 and carries a pre-existing
  0016 collision (two files numbered 0016); this record is **0019** per PRD #226.
