---
status: accepted
---

# Organisation as tenant boundary

## Context

The app was effectively **single-tenant**. `DataEntryViewSet.get_queryset()`
starts from `DataEntry.objects.all()` and filters only by ring/project query
params — never by user or Organisation; `/rings/`, `/ringing-stations/`,
`/organizations/` and `/species/` are likewise global. Only `/projects/` and
`/species-lists/` are user-scoped. Any authenticated user can therefore list
**every** capture in the system. That was acceptable with one Organisation (IWM
Linz) but is a showstopper for going public: the second invited ringer from an
unrelated body would see everyone else's data — a DSGVO incident on day one.

Compounding it, `Scientist` (Beringer) has **no** FK to `Organization`; the only
org link is transitive through a `Project`'s `scientists` M2M. There is no
"account X belongs to Organisation Y" relation to scope queries by.

## Decision

The **Organisation is the tenant** — the unit of data ownership and isolation.
Every capture, Station, Projekt and Ring belongs to exactly one Organisation;
members of one Organisation see each other's data, members of different
Organisations never do. Reference data (`Species`) stays global.

- **Mitgliedschaft** — a link between an account and an Organisation carrying a
  **Rolle** (`Admin | Mitglied`). Memberships are **per Organisation** and
  multiple are allowed (a Beringer may ring for more than one body), so the Rolle
  is per-org: Admin in one, plain Mitglied in another. The multi-org *model*
  ships now; the org-switcher *UI* is deferred until a user is actually in 2+
  Organisations.
  - **Admin**: invite/remove Mitglieder, manage Stationen, create/edit/delete
    Projekte, manage Beringer, edit the Organisation, pull the IWM export.
  - **Mitglied**: record and edit captures across the whole Organisation; no
    structural management.
- **No-account Beringer are retained** ([ADR 0001](0001-account-independent-beringer.md))
  as org-owned selectable names with no Mitgliedschaft and no Rolle. Any Mitglied
  may quick-add one mid-session; deletion stays admin-only
  ([ADR 0003](0003-beringer-deletion-reassign-to-fallback.md)).
- **Gating sits only on org creation**: a newcomer founds a new Organisation
  (and becomes its Admin) only with a valid **Zugangscode** issued by the
  operator. Growing a team inside an admitted Organisation (**Org-Einladung**) is
  **ungated** but capped by the Organisation's **Seat-Limit**. The operator
  controls Organisations, not headcount.
- **Monetisation is per Organisation**: `Organisation.plan` (default `beta`), a
  Seat-Limit (default 5 — each Mitgliedschaft, including the Admin, consumes one
  seat; **no-account Beringer consume none**), and a durable `beta_cohort` marker
  — separate from the mutable plan — entitling beta-era Organisations to a
  permanent preferential price at 1.0. No billing is implemented now.

## Considered options

- **User/Beringer as the tenant boundary.** Rejected: a Beringer rings for a
  body and the data belongs to that body; colleagues within one body must share
  visibility, and per-user isolation would fracture that.
- **Single Organisation per user.** Rejected: real ringers ring for several
  schemes; modelling multi-org now is cheap, retrofitting it after data exists is
  not.
- **Remove no-account Beringer, make every Beringer an account.** Rejected — it
  would reverse [ADR 0001](0001-account-independent-beringer.md): it forces a
  login on field helpers (e.g. a 70-year-old who rings a dozen birds and will
  never log in), reintroducing exactly the friction ADR 0001 removed.
- **Seat-based pricing as the unit.** Rejected as the *unit*: it penalises the
  team growth the land-grab strategy wants (more data-enterers ⇒ more data ⇒ more
  lock-in). Per-Organisation is simpler and the Admin is the obvious payer. Seats
  are still tracked as the future pricing basis.

## Consequences

- Every ViewSet queryset must filter to the requesting user's Organisation(s);
  `Scientist` gains an Organisation link; `RingingStation`/`Project` already
  carry one and must enforce it. Cross-tenant reads become impossible by
  construction. `Ring` is scoped separately — see
  [ADR 0006](0006-ring-scoped-to-organisation.md).
- A coordinated migration assigns all existing data to the founding Organisation
  "IWM Linz" (Admin `filip`, `plan = beta`, `beta_cohort`, bumped Seat-Limit).
- DSGVO: the Organisation is the **controller** of its capture data and BirdDoc
  the **processor**; a DPA is accepted at org creation. (Details live in the PRD
  and Terms, not here.)
