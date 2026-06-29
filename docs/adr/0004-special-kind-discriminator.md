---
status: accepted
---

# special_kind discriminator supersedes is_sentinel

## Context

`Species` carried a boolean `is_sentinel` to mark the single non-taxon row
"Ring Vernichtet" (a destroyed-ring marker). That flag had been overloaded to
mean three different things at once: the row is **always selectable** (it
bypasses the active Artenliste), the form **collapses** to the essentials when
it is chosen, and the backend **nulls every bird-data field** on save.

Issue #57 introduces a second non-taxon row — "Art nicht in der Liste (Aves
ignota)" — for a bird that is genuinely caught but not on the active list. It
shares only one of those behaviours (always selectable). Unlike Ring vernichtet
it is a real bird: the full measurement form stays, and instead its **Bemerkung
becomes mandatory** so the unusual catch is always described. A single boolean
cannot express two rows whose behaviours overlap only partially.

## Decision

Replace `is_sentinel` with a single `special_kind` **discriminator** (a
`CharField` with choices) on `Species`, and derive each behaviour from its value
rather than from one conflated flag:

- `""` — a normal taxon.
- `"ring_destroyed"` — the "Ring Vernichtet" marker (no bird; collapses the
  form; bird-data fields nulled server-side).
- `"unknown_species"` — the "Aves ignota" marker (a real bird; full form;
  Bemerkung mandatory).

Behaviours re-keyed off `special_kind`:

- **Visibility** (always selectable, bypasses the active Artenliste) =
  `special_kind != ""`.
- **Form-collapse + server-side bird-data null-out** = `special_kind ==
  "ring_destroyed"`.
- **Mandatory Bemerkung** = `special_kind == "unknown_species"`, enforced in two
  layers: the form toggles a `required` validator on the comment control, and
  `DataEntrySerializer.validate()` rejects a blank comment server-side. The
  model and admin stay unconstrained so a Sonderart row can still be repaired
  freely.

`is_sentinel` is removed entirely from model, serializer and frontend — the app
is in beta with no external API consumers, so no compatibility shim is kept. A
data migration converts the existing `is_sentinel=True` row to
`special_kind="ring_destroyed"`; a second data migration creates the Aves-ignota
`unknown_species` row, both following the established "Ring Vernichtet"
data-migration pattern.

## Considered options

- **Add a second boolean (`is_unknown_species`)** — rejected: booleans multiply
  with each new non-taxon row and leave illegal combinations (`is_sentinel` and
  `is_unknown_species` both true) representable. A single discriminator makes the
  kinds mutually exclusive by construction.
- **Keep `is_sentinel` and special-case Aves ignota by its German name** —
  rejected: behaviour keyed off a display string is brittle and invisible to the
  data model.
- **A nullable FK to a `SpeciesKind` table** — rejected as over-engineered for a
  closed, tiny set of kinds; a choices field keeps the values in code where the
  derived behaviours live.

## Consequences

- Each Sonderart behaviour is now independent and reads directly off
  `special_kind`; adding a future kind is a new choice value plus the behaviours
  it opts into, with no boolean combinatorics.
- The always-selectable set returned by `GET /species/` grows from one row to
  every `special_kind != ""` row, so an active Artenliste now surfaces both
  "Ring Vernichtet" and "Aves ignota".
- The ring-number suggestion still counts a destroyed ring as a consumed rope
  number; that rule is re-keyed from `species.is_sentinel` to `species.special_kind
  == "ring_destroyed"` and is unchanged in effect.
- See the **Sonderart** entry in CONTEXT.md for the domain-language summary.
