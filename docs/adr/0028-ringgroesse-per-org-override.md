---
status: accepted
---

# Empfohlene Ringgröße gains a per-Organisation override, resolved independently of the Artennorm

## Context

Beta-user feedback (user-feedback.md #5) asks to **set the ring size per species
in the Artennormen editor**. Today the **Empfohlene Ringgröße** lives on
`Species.ring_size` as **global reference data** (ADR 0005 boundary; it also feeds
the public Wissen-Artenseite "welche Ringgröße für diese Art?"), and ADR 0021
explicitly excluded ring size from the Artennorm ("It is *not* part of Species
identity … a separate, optional profile").

The user chose a **two-layer** model, mirroring the Artennorm: a global standard
plus an optional per-Organisation override, with the effective value = override ??
global. But ADR 0021's override is **whole-row replace** — the org row replaces
the global row entirely, and a null column means "that check is off." Ring size
is a **single default value, not a check**, so it cannot ride that mechanism:

- If `ring_size` were a column on the whole-row-replaced `SpeciesNorm`, an org
  that wanted *only* a ring-size override would have to create a `SpeciesNorm` row
  whose norm columns are all null — which under whole-row semantics **switches off
  every plausibility check** for that species. Setting a ring size would silently
  break the norms, and vice versa.

## Decision

Give the **Empfohlene Ringgröße** a **per-Organisation override that resolves
independently** of the Artennorm's whole-row override:

- **Global default** — stays on `Species.ring_size` (global reference data,
  operator-editable via admin/migrations; unchanged). The public Wissen-Artenseite
  keeps reading this global value — org overrides never leak to the public site.
- **Org override** — a distinct per-`(species, organization)` ring-size override
  (its own field/table, **not** a column on the whole-row `SpeciesNorm`), so
  setting a ring size neither creates nor disturbs a norm-override row and never
  toggles a plausibility check.
- **Effective Empfohlene Ringgröße = org override ?? `Species.ring_size`** — a
  per-value coalesce (null override = **inherit** the global), *not* whole-row
  replace. This drives the ring-size pre-fill at data entry; the offline bundle
  ships the pre-resolved per-org value alongside the norms.
- **In-app surface** — the Artennormen editor gains a ring-size field that writes
  the **org override** (Admin-only, like the norm overrides). The global default is
  not editable in-app, consistent with ADR 0021.
- Explicitly overriding to "*no* recommendation" (clearing a global that has one)
  is **not modelled** — null means inherit; the need is negligible.

## Considered options

- **A `ring_size` column on `SpeciesNorm` (whole-row).** Rejected — a ring-size-only
  override would null out the norm columns and disable every check for that
  species (and vice versa). Whole-row semantics are right for the checks, wrong for
  a standalone default value.
- **Edit `Species.ring_size` globally from the editor.** Rejected — `Species` is
  non-tenant-scoped; one Admin's edit would change the recommendation (and the
  public Artenseite) for every Organisation.
- **Per-column coalesce on `SpeciesNorm` (inherit vs off).** Rejected for the norm
  checks by ADR 0021 (null-ambiguity); ring size sidesteps it precisely by being a
  *separate*, independently-resolved value where null unambiguously means inherit.

## Consequences

- Ring size and the plausibility norms are overridden **independently**: an org can
  tune one without touching the other. This is the deliberate counterpoint to ADR
  0021's whole-row rule — correct here because ring size is a value, not a check.
- The public Wissen-Artenseite is unaffected; it continues to show the global
  `Species.ring_size`.
- Refines, does not supersede, ADR 0021 (which stays about the plausibility norms).
- See the **Empfohlene Ringgröße** and **Artennorm** entries in CONTEXT.md.
