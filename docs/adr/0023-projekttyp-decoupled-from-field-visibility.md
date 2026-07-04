---
status: accepted
---

# Projekttyp is descriptive metadata, decoupled from capture-field visibility

## Context

Field feedback asked for two project-level additions at once:

1. A **Projekttyp** on a Projekt — one of IWM, IMS, Zugvogelmonitoring,
   Nestlingsberingung, Sonstiges.
2. The ability to **show/hide the Netz/Netzfach fields per Projekt**, because some
   programmes (notably Nestlingsberingung — birds ringed in the nest) never use
   mist-nets, so the Netznr./Netzfach/Flugrichtung inputs are noise there.

The two correlate almost perfectly: of the five types, only Nestlingsberingung uses no
nets. That makes it tempting to let the Projekttyp **drive** field visibility — a single
type→fields table, no second knob. This ADR records that we deliberately did **not** do
that.

## Decision

**Projekttyp is descriptive, internal metadata only.** It is optional (unset reads as
Sonstiges), single-valued, **never exported** (the IWM export ignores it), and **gates no
capture field**.

**Net/pocket visibility is an independent per-Projekt boolean** (a new flag parallel to
the existing `show_optional_fields`), default **on**, hiding the whole net block
(Netznr. + Netzfach + Flugrichtung) when off. Hiding is display-only — values already
stored on historical captures are untouched and still export.

The Projekttyp may at most **seed that toggle's default** at project creation (e.g. a new
Nestlingsberingung project starts with nets off) — a convenience, never an enforced
coupling.

## Considered options

- **Projekttyp drives field visibility (no separate toggle).** Rejected — it bakes a
  rigid type→fields table into the form/export path (hard to change), leaves "Sonstiges"
  with no defined answer, and produces surprising implicit behaviour (changing a project's
  type silently rewrites which fields exist). The user explicitly asked for an *explicit*
  per-project toggle.
- **Fold nets into the existing `show_optional_fields` toggle.** Rejected — that flag
  gates an unrelated block (the biometric checkboxes: Milben/Hungerstreifen/Brutfleck/CPL);
  overloading it would surprise anyone flipping it for one group and moving the other.
- **Make Projekttyp feed the IWM export.** Rejected here — the five type names are
  programme classifications, not IWM codes, and none map cleanly to an export column.
  Encoding the programme into the export is a separate, larger decision to take
  deliberately, not fold in.

## Consequences

- A future reader seeing `Projekttyp = "Nestlingsberingung"` alongside a separate
  "show net fields" boolean has this record explaining why visibility is **not** derived
  from the type — so the two are not "helpfully" re-coupled, which would remove the
  flexibility on purpose.
- Both additions are cheaply reversible in isolation: the enum is a descriptive column,
  the toggle is one boolean, and neither touches export or validation logic.
- Adding a sixth Projekttyp, or changing which type seeds nets-off, is a one-line change
  with no ripple into field visibility.
