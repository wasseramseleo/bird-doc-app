---
status: accepted
---

# Org-admin station management: archive over delete, server-owned handle

## Context

Stations could only be created in the Django admin, so an Organisation Admin
could not add a ringing site without operator help. The REST `RingingStationViewSet`
already gated writes to org Admins and already refused a write whose Organisation
is not the actor's own (`_reject_foreign_organization` in `perform_create`/
`perform_update`), so the tenant boundary ([ADR 0005](0005-organisation-as-tenant-boundary.md))
was intact. But the SPA exposed no UI, the write serializer only carried
`name` + `handle`, and two sharp edges surfaced once we set out to expose
creation to Admins:

- `DataEntry.ringing_station` is `on_delete=PROTECT`, so a Station that owns
  captures cannot be deleted — yet a retired site must somehow disappear from the
  capture picker without taking its history with it.
- The Station `handle` is the primary key: globally unique, permanent, and
  unrenameable. It has no user meaning (it is **not** the IWM Ortskodierung, and
  it is never exported), so exposing it as an input invites collisions and
  confusion.

## Decision

Org Admins manage Stations in-app (a "Stationen verwalten" view reached from the
user menu, gated on the Admin Rolle now surfaced to the frontend). Three rules
make it safe:

- **Archive over delete.** A Station carries an `aktiv`/`archiviert` flag.
  Archiving hides it from the capture picker while keeping it bound to its
  historical captures and their IWM export. A hard delete is offered **only**
  when the Station owns zero captures; otherwise the Admin archives. Same
  never-orphan-captures principle as the Beringer fallback ([ADR 0003](0003-beringer-deletion-reassign-to-fallback.md)),
  reached differently: a Station has no natural "fallback sink", so it is hidden
  rather than reassigned.
- **Server owns the handle.** The `handle` is machine-derived on create (from the
  Organisation and the name, deduplicated) and never shown or edited — mirroring
  how the Beringer Kürzel is auto-derived. The Admin supplies only human fields:
  Name, Ortskodierung, Land, Region, coordinates. The export-critical fields
  (Name, Ortskodierung, Breitengrad, Längengrad) are **required at creation** so
  a Station made in-app always produces valid IWM rows; Land defaults from the
  Organisation's country, Region is optional.
- **Server owns the tenant (consistency).** On create the backend sets
  `organization = active_organization(request.user)` and makes the client
  `organization_id` optional and overridden — matching the Projekt create pattern,
  so the SPA needn't send it. This is a UX/consistency alignment, **not** a
  security fix: `_reject_foreign_organization` already refused a foreign-org
  write. It simply removes a required field that could only ever equal the
  actor's own Organisation.

## Considered options

- **Hard delete, blocked by PROTECT.** Rejected: a retired-but-used site would
  linger in the capture picker forever with no way to hide it.
- **`SET_NULL` / cascade on capture deletion.** Rejected for the same reasons as
  [ADR 0003](0003-beringer-deletion-reassign-to-fallback.md): captures are the
  product and must never be lost or de-located.
- **Admin types the handle.** Rejected: a permanent, globally-unique key with no
  user meaning is a UX trap and collides across tenants.

## Consequences

- The Station model gains an `aktiv`/`archiviert` field (migration) and the
  capture picker filters to active Stations; historical captures and exports are
  unaffected by archiving.
- Stations created before this change may have blank Ortskodierung/coordinates;
  the required-field rule applies to the in-app form, so editing such a Station
  nudges the Admin to complete it (the model itself still allows blank for
  backward compatibility).
- The user's Rolle (Admin vs Mitglied) is now exposed to the frontend `/me`
  payload — previously it only knew the Django `is_staff` flag, which is a
  different, narrower thing than an org Admin.
