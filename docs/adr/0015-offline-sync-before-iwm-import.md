---
status: accepted
---

# Operational rule: sync field devices before IWM-importing the same period

## Context

PRD #152 (offline field data entry) and PRD #113 (IWM import, ADR 0013) are two
independent ingestion paths into the same `DataEntry` table, developed in
parallel:

- An **offline field device** queues captures locally and, on reconnect,
  **syncs** them one at a time through the ordinary capture-create path (the
  same endpoint the online form already uses), guarded by a client-generated
  idempotency UUID (PRD #152, "Backend surface"). That UUID only protects
  against *retrying the same POST* — a dropped connection mid-sync replaying
  the identical request. It does nothing to detect that a *different* capture
  (a different UUID) happens to describe the same physical event.
- The **IWM import** service (`birds/iwm_import.py`, ADR 0013) parses a
  spreadsheet and, before creating anything, skips any row whose
  **capture key** — `(ring size, ring number, capture date_time)` — already
  exists in the Organisation (`_capture_key` / `_existing_keys` in
  `iwm_import.py`). This is precisely what makes re-importing a corrected
  sheet safe (issue #122): rows already present are recognised and skipped.

Both paths can describe the very same real-world capture: a Mitglied records
a session offline, and the same period's captures also live in (or get
re-entered into) an IWM sheet the Organisation imports — e.g. a mixed
paper/offline session later reconciled from the club's spreadsheet, or a
historical bulk import that overlaps a trip a field device hasn't synced yet.
Because only the **import** side carries duplicate detection, the two
possible orderings behave differently:

- **Sync first, then import**: the synced captures already exist in the
  Organisation by the time the sheet is imported. The import's existing
  capture-key dedup (ADR 0013) recognises and skips them automatically — no
  new code needed.
- **Import first, then sync**: the imported captures exist first, but the
  offline device's sync path has no equivalent check — it POSTs each queued
  capture through the ordinary create endpoint, which has no capture-key
  dedup. Every one of those captures lands as a **new, genuinely duplicated**
  `DataEntry` row.

## Decision

**No cross-feature dedup code.** Instead, document and rely on an
**operational rule**: sync outstanding field devices for a period **before**
running an IWM import that covers the same period. This was decided in
PRD #152 ("Interaction with PRD #113 (IWM import)" / Out of Scope) precisely
because the ordering above makes the rule sufficient — sync-before-import
piggybacks on duplicate detection that already exists in the import path
(ADR 0013), so no new mechanism has to be built or maintained on the sync
side.

In practice: an Org-Admin about to import a Datenmeldung sheet should first
confirm that any field devices covering the same date range have connected
and synced (checked via each device's **Offline-Bereitschaft** / **zuletzt
synchronisiert** indicator — see `CONTEXT.md`). This is a process note for
Admins, not a system guarantee — nothing in the app currently blocks an
import while a device has un-synced entries for the period.

## Considered options

- **Reject the rule and build cross-feature dedup** (e.g. have offline sync
  also check the import's capture-key logic, or vice versa). Rejected by the
  PRD as unnecessary complexity for an edge case with a simple operational
  workaround; revisit only if it occurs in practice (PRD #152 Out of Scope).
- **Import first, then sync, relying on sync-side dedup.** Rejected: sync has
  no capture-key dedup today (only retry-safe UUID idempotency), so this
  ordering silently creates real duplicate captures. This is the reason the
  rule is directional (sync-before-import), not symmetric.

## Consequences

- No schema or code change. This ADR exists to make the ordering requirement
  discoverable, since it isn't self-evident from either feature's code in
  isolation.
- If duplicate offline-vs-import captures turn out to happen in practice
  despite the documented rule, the fix would most likely be teaching the
  offline sync path the same capture-key dedup the import path already has
  (`_capture_key` in `birds/iwm_import.py`) — not the reverse.
- Referenced from `CONTEXT.md`'s offline glossary entries so the vocabulary
  (Offline-Bereitschaft, zuletzt synchronisiert) and the operational rule
  stay discoverable together.
