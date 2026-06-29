---
status: accepted
---

# Beringer deletion reassigns captures to a reserved fallback

## Context

A Beringer ([ADR 0001](0001-account-independent-beringer.md)) is a first-class,
account-independent entity reused across captures. `DataEntry.staff` pointed at
it with `on_delete=PROTECT`, so a Beringer who already owned captures could not
be deleted at all — the database refused. That is too strict (a Beringer created
by a typo, a duplicate, or someone who must be removed cannot be cleaned up) yet
also unsafe to relax naively: every capture must keep a non-null `staff`, and
the recorded captures are the product itself — losing them is never acceptable.
Deletion is an **admin-only** operation; the app UI offers no delete affordance
and must not gain one.

## Decision

Deleting a Beringer **reassigns** all of their captures to a single reserved
fallback Beringer rather than blocking or cascading:

- `DataEntry.staff` changes from `on_delete=PROTECT` to
  `on_delete=models.SET(get_fallback_beringer)`. The resolver lives on the model
  so it covers **every** deletion path uniformly — admin single, admin bulk
  (`QuerySet.delete()`), shell, and ORM — with no per-view override.
- The fallback is one reserved `Scientist` row: Kürzel `GELÖSCHT`, name
  "Gelöschter Nutzer", created by a data migration (`0036`) that mirrors the
  existing "Ring Vernichtet" sentinel migration (`0032`). The resolver looks it
  up and creates it defensively (`get_or_create`) so the contract holds even if
  a delete somehow precedes the migration.
- `ScientistViewSet`'s queryset excludes the reserved Kürzel, so the fallback
  never appears in the Beringer list or autocomplete (including a search that
  would otherwise match its name) and no fresh capture can be filed against it.

## Considered options

- **Keep `PROTECT`.** Rejected: a Beringer who owns captures can never be
  removed, leaving typos and duplicates permanently in the autocomplete.
- **`CASCADE`.** Rejected outright: deleting a Beringer would delete their
  captures — the one outcome the system must never allow.
- **`SET_NULL`.** Rejected: every capture needs an attributable Beringer for
  records and the IWM export; a null `staff` is not a meaningful Beringer and
  would push null-handling into every consumer.
- **Per-view reassignment (admin override).** Rejected: it would miss the shell
  and ORM paths and silently re-PROTECT them. Putting the contract on the model
  via `on_delete=SET` makes it total.

## Consequences

- No capture data is ever lost when a Beringer is deleted; orphaned captures
  collect under one clearly-labelled "Gelöschter Nutzer" entity.
- The fallback is a write-only sink from the app's perspective: hidden from the
  autocomplete, so it adopts captures but is never newly selected. Reassignment
  is not reversible from the app — the original Beringer identity is gone.
- Deletion stays admin-only; `/scientists/` remains create/read-only (no
  edit/delete over the API), consistent with [ADR 0001](0001-account-independent-beringer.md).
