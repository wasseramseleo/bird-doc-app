---
status: accepted
---

# Ring scoped to Organisation

## Context

`Ring` carries `unique_together = ("size", "number")` — **globally unique**, with
no Organisation link. With the Organisation as the tenant boundary
([ADR 0005](0005-organisation-as-tenant-boundary.md)) this couples tenants: two
Organisations cannot independently own the same `(size, number)`, and a shared
Ring row lets one Organisation infer the existence of another's ring.

It looks harmless today only because of the Austrian scheme: the central (AOC /
Österreichische Vogelwarte) issues ring numbers, so within Austria `(size,
number)` really is unique. But the product aims beyond Austria, and different
EURING schemes number independently — an Austrian `V 0042` and a German `V 0042`
are two different physical rings that the global constraint would force into one
row.

## Decision

Scope `Ring` to the Organisation: uniqueness becomes
`(organisation, size, number)`, and each Organisation owns its own Ring rows. A
recapture (Wiederfang) of a foreign ring simply creates a Ring row in the
recording Organisation carrying that number — BirdDoc records the number that was
read, it does not resolve ring identity across Organisations.

A future EURING-scheme dimension can be added additively if cross-scheme ring
identity is ever needed.

## Considered options

- **Keep `Ring` global.** Rejected: harmless only for single-scheme Austria,
  breaks under EURING, and couples tenants even now.
- **Scope to a Scheme (EURING), shared across Organisations.** Rejected for now:
  domain-correct but needs a Scheme entity and cross-org sharing — more than the
  beta requires. Left as the additive future step.

## Consequences

- `next-number` (already project- and therefore org-scoped) and the
  orphaned-Ring cleanup continue to work unchanged within an Organisation.
- The data migration partitions existing Ring rows under "IWM Linz".
- The same physical ring is not unified across Organisations; acceptable —
  captures only need the number, and per-tenant isolation is the priority.
