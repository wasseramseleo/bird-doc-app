---
status: accepted
---

# Artennorm — global default plus additive per-Organisation override

## Context

The Plausibilitätsprüfung (feature Artenattribute) needs per-species measurement
norms — a Mittelwert and spread per Gewicht/Federlänge/Flügellänge/Tarsus/Kerbe
F2/Innenfuß, a Quotient, and two categorical flags — to flag a likely Messfehler at
data entry. Two requirements pull against each other:

- Every Organisation should get useful checks **out of the box**, with no setup.
- An Organisation's Admin must be able to **tune** the norms *auf Organisationsebene*
  (the brief's explicit ask).

`Species` is **global reference data, never tenant-scoped** (ADR 0005 boundary; like
`Central`, ADR 0019). But the seed values come from *one* Austrian Beringungsprojekt —
they are sensible defaults, not universal truth — and measurement norms are
population-specific. Tenant isolation (ADR 0005) forbids one Organisation's edit from
affecting another.

## Decision

A new `SpeciesNorm` table (domain: **Artennorm**) keyed `(species, organization)` with
a **nullable `organization`**:

- `organization IS NULL` ⇒ the **globale Standard-Artennorm**, seeded once and shared
  like `Species` reference data.
- `organization = X` ⇒ that Organisation's **override**.
- **Effective norm = the org override if one exists, else the global default** — a
  single lookup, **replace-whole-row**, never a per-column merge. All measurement
  columns are nullable; a null column means *that check is off*, so clearing a field in
  an override lets an org **disable** a check the default enables.

The check is **client-side and non-blocking**; the server never runs the Ausreißertest
and stores no acknowledgment. This mirrors ADR 0019's "additive to Organisation" stance
for a different entity.

## Considered options

- **Columns on `Species` (global-only).** Rejected — `Species` is explicitly
  non-tenant-scoped; per-org tuning would be impossible and one edit would hit every
  tenant.
- **Per-Organisation only, no global default.** Rejected — new Organisationen would get
  *no* checks until an Admin configures them, and the seed can't target Organisationen
  that don't exist yet; the ~11 seed rows would have to be copied into every tenant.
- **Column-level merge (override coalesces per column with the default).** Rejected —
  null becomes ambiguous (*inherit* vs *off*), so an org cannot disable a default check;
  and the effective lookup degrades from one row to a per-column coalesce.
- **Server-side enforcement and/or a stored acknowledgment.** Rejected — a
  genuinely-unusual-but-real bird must record frictionlessly (the Aves-ignota spirit),
  IWM-imported historical rows must not warn or block, and an audit field adds schema
  for a need no one stated.

## Consequences

- The effective norm resolves in a single query (`org row ?? NULL-org row`); the offline
  bundle ships the pre-resolved per-org list keyed by `species_id`, so the client checks
  identically online and offline.
- An Organisation that overrides holds a **full copy** and will not inherit a later
  improvement to the global default for that species — the intended meaning of override.
- Adding a further measurement, or a `sex` dimension later, is an additive migration; it
  does not disturb this decision.
- The global defaults remain editable by the operator (Django admin / migrations); the
  in-app editor exposes **only** org overrides, keeping tenant isolation intact.
