---
status: accepted
---

# Org-admin Beringer management in-app: CRUD and account linking

## Context

A Beringer (the `Scientist` model) was create-and-read over the API — creation
open to any authenticated Mitglied for the mid-session quick-add ([ADR 0001](0001-account-independent-beringer.md))
— while **edit and delete were Django-admin-only**, with deletion reassigning
captures to the reserved `GELÖSCHT` fallback at the model layer ([ADR 0003](0003-beringer-deletion-reassign-to-fallback.md)).
An Organisation Admin could therefore not add, edit or delete Beringer, nor
manage which login account a Beringer belongs to, without operator help.

Two gaps motivated a change:

- **Management lived in the wrong place.** [ADR 0011](0011-station-archive-over-delete.md)
  already moved Station management out of the Django admin into the in-app
  Org-Admin surface (gated on `Rolle = ADMIN`). Beringer had no such surface.
- **The account link was unreachable.** A Beringer's link to a login account is
  `Scientist.user` — a **nullable OneToOne** ([ADR 0001](0001-account-independent-beringer.md)).
  It is set automatically only when an Organisation is *founded*; accepting an
  Org-Einladung creates a `Mitgliedschaft` (a seat) but **no** `Scientist`. So a
  helper quick-added as a no-account Beringer, then invited, becomes two
  disconnected things: a no-account Beringer that owns captures, and a seat with
  no Beringer. Nothing in the app could reconcile them.

## Decision

Give Org Admins an in-app **Beringer verwalten** page (route `/beringer`, in the
user menu beside *Stationen verwalten*), gated on `Rolle = ADMIN`, mirroring the
Stationen surface ([ADR 0011](0011-station-archive-over-delete.md)).

1. **Widen `ScientistViewSet` to a full `ModelViewSet`** (one endpoint, matching
   the one-viewset-per-model convention) rather than adding a second admin
   viewset. Permissions are **per-action** and deviate from Stations in exactly
   one way: `create` and read stay open to any Mitglied (quick-add — [ADR 0001](0001-account-independent-beringer.md)),
   while `update` and `destroy` are Admin-only. The linked-account fields are
   serialized and writable **only for Admins**, so the shared `/scientists/`
   autocomplete list — which every Mitglied hits — never leaks member data.

2. **Delete reuses the [ADR 0003](0003-beringer-deletion-reassign-to-fallback.md)
   reassign-to-`GELÖSCHT` machinery** and is the in-app affordance that ADR 0003
   previously withheld (this supersedes ADR 0003's "the app UI offers no delete
   affordance … and must not gain one" / create-read-only consequence; the
   operator's Django admin stays the ultimate authority). Rules:
   - A Beringer that **is a Mitglied** (linked to an account) is **not deletable
     here** — removing a member is seat management (`/mitgliedschaften/`).
   - An **unlinked** Beringer with **zero captures** hard-deletes; one that owns
     captures **reassigns** them to `GELÖSCHT` behind a count-named confirmation.
   - **No archive / `is_active` on `Scientist`.** Reassignment *is* the Beringer
     equivalent of Station-archive, reached differently because a Beringer has a
     fallback sink and a Station does not (the same asymmetry [ADR 0011](0011-station-archive-over-delete.md)
     already names).

3. **The account link (`Scientist.user`) is Admin-editable, addressed by seat.**
   The client sends `mitgliedschaft_id` (`null` = detach); the server resolves
   `Scientist.user = mitgliedschaft.user` and validates, in one place, that the
   seat is in the actor's active Organisation (tenant boundary — [ADR 0005](0005-organisation-as-tenant-boundary.md)),
   that its user has no existing `Scientist` (the OneToOne), and the freeze rule:
   - **Attach from empty is always allowed** — even when the Beringer already
     owns captures (this is the primary workflow: reconcile a field-helper record
     with the account they were later given).
   - **Detach or re-point is frozen once the Beringer owns captures** — neither
     may strip a capture-owning identity from its account. The Django admin is
     the escape hatch for the rare mis-attach.
   - Detach of a **capture-free** linked Beringer demotes it to a no-account
     Beringer (reversible; the account keeps its login and Rolle but loses its
     Beringer identity and Projekt visibility until re-linked).

4. **The Kürzel stays editable and user-facing** — unlike the Station handle,
   which [ADR 0011](0011-station-archive-over-delete.md) made server-owned and
   hidden because it is internal and never exported. The Kürzel goes into the IWM
   export and needs manual disambiguation ([ADR 0001](0001-account-independent-beringer.md)
   left collisions "for manual fix" — this is that surface). It is prefilled from
   the name but overridable; a name edit never rewrites an existing Kürzel; in
   deliberate management a duplicate Kürzel is an error, while the quick-add
   endpoint keeps its offline idempotency.

5. **A "Mitglieder ohne Beringer-Eintrag" panel** surfaces the gap — a seat whose
   Beringer is unresolved (`MitgliedschaftSerializer.handle` is `null`). Each such
   member offers *verknüpfen* (attach an existing no-account Beringer) or *neu
   anlegen* (create a link-free Beringer via the open endpoint, then attach). Two
   symmetric entry points thus mutate the same validated `mitgliedschaft_id`
   link: the Beringer edit dialog (Beringer → seat) and the gap panel (seat →
   Beringer).

## Considered options

- **A separate admin viewset** (`/beringer-management/`) instead of widening
  `/scientists/`. Rejected: it is novel in this codebase (one viewset per model
  elsewhere) and splits create from update/delete across two routes; the
  per-action permission + Admin-only serializer fields achieve the same isolation
  on one endpoint.
- **Auto-create a Beringer on Org-Einladung accept.** Rejected: linking stays an
  explicit Admin act so an existing field-helper record can be reconciled rather
  than shadowed by an auto-created duplicate. The gap panel makes the pending
  work visible instead.
- **Archive Beringer like Stations.** Rejected for this cut: a Beringer already
  has a never-orphan mechanism (the `GELÖSCHT` sink); a separate `is_active` is
  redundant. The cost — deleting a real capture-owning helper sends their
  attribution to `GELÖSCHT` rather than preserving it — is accepted, with archive
  left as a possible follow-up.

## Consequences

- **Multi-org limitation (flagged).** `Scientist.user` is a OneToOne **globally**,
  so an account can back at most one Beringer across all Organisations. A
  multi-org account — which the app does not yet support (`active_organization`
  returns `None` for an account with more than one Mitgliedschaft, pending the
  deferred org-switcher) — therefore cannot be a linked Beringer in more than one
  Organisation, and such a seat is simply not offered in another org's attach
  picker. Accepted for now; when the org-switcher lands, this link likely has to
  become **per-Organisation** rather than a global OneToOne.
- **Global Kürzel uniqueness (follow-up).** `Scientist.handle` is `unique=True`
  globally, inconsistent with the otherwise org-scoped model (rings went per-org
  in [ADR 0006](0006-ring-scoped-to-organisation.md)); two Organisations cannot
  both hold a given Kürzel. Left as a follow-up — the management flow handles the
  constraint gracefully (a clean 400, never a 500) rather than fixing the schema
  here.
- The delete affordance and edit/link endpoints are Admin-gated in-app; the
  Django admin retains full, unrestricted control as the escape hatch for the
  frozen-once-captures link and any cross-tenant repair.
