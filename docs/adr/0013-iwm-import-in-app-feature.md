---
status: accepted
---

# IWM import as an in-app, Org-Admin feature

## Context

Organisations onboarding to BirdDoc bring **existing ringing data** — years of
captures in an IWM `Datenmeldung` sheet. We first scoped IWM ingestion as a one-off
Django migration to seed the demo Referenzprojekt (ADR 0012). But if every real
Organisation needs to import its history, a migration is the wrong shape: import
belongs **in the app**, driven by the Org-Admin, reused across every org and the
demo alike.

Today there is no import path at all (only the export, ADR 0002), no file-upload
endpoint anywhere, and **no task queue / async infrastructure** (no Celery/RQ/etc.)
— a synchronous request is all that exists. Writes are strictly tenant-scoped
(ADR 0005) and structural writes are Admin-only; the IWM **export** is already an
Admin-only `@action` on `ProjectViewSet`, a natural mirror for import.

A real IWM sheet is messy: unknown species, unfamiliar Beringer/Stationen,
duplicate rings, bad codes. And the authentic national IWM format differs from what
our own export writes (authentic Geschlecht is `U/M/W`; our export writes integer
`0/1/2`), so import and export are not currently inverses.

## Decision

Build a single **IWM import service** — parse → validate → create captures — and
expose it in the app. It is the one code path for all ingestion; the demo
Referenzprojekt seed (ADR 0012) calls the same service via a `seed_demo_org`
command.

- **Entry point.** An Org-Admin, having selected a Projekt, clicks **Import** on the
  *Letzte Fänge* screen (`DataEntryListComponent`). Backend:
  `POST /api/birds/projects/{id}/import-iwm/`, Admin-only (`IsOrgAdmin`, mirroring
  export), multipart upload. Imported captures land in that Projekt and its
  Organisation.
- **Synchronous, optimised, capped.** No new infra. One request parses and
  bulk-creates within an atomic transaction, with pre-resolved lookups, under a row
  **cap** (~2–5k). Files over the cap are rejected with guidance to use the
  `seed_demo_org`/import **management command** (the same service, ops-assisted) for
  large one-time backfills. Async is deferred until real orgs exceed the cap.
- **Dry-run preview → commit.** Upload first returns a **validation report**:
  importable count, entities that will be auto-created, duplicates that will be
  skipped, and per-row **errors** and **warnings** (row number + reason). The Admin
  confirms; commit is atomic and imports the valid rows, **skipping** blocking-error
  rows.
- **Skip duplicates by capture key.** A row matching an existing capture on
  `(ring size + number, date + time)` within the org is skipped and reported — never
  re-inserted. An Erstfang and its Wiederfang share a ring but differ by datetime, so
  both import. This makes fix-a-few-rows-and-re-import safe.
- **Entity resolution.** Unknown **species** (by `common_name_de`) is a **blocking
  error** — taxonomy cannot be invented (the Sonderart names import as their
  Sonderarten). Unknown **Beringer** (Kürzel) → a new no-account Beringer (ADR 0001);
  unknown **Station** → a new Station from the file's name/Ortskodierung/Region/
  coords. Both auto-creations are **listed in the preview** for approval.
- **Fangmethode/Lockmittel/Umstand are Projekt properties, not per-capture.** The
  selected Projekt's values are authoritative; the file's columns are informational
  (a homogeneous file whose value differs raises a warning; if the Projekt's value is
  unset and the file is homogeneous, adopt it). The model cannot store per-row
  method.
- **One canonical format — align the export.** Import targets authentic IWM, and
  `iwm_export.py` is corrected to emit the same codes (Geschlecht `U/M/W`, category
  codes as text) so export and import are inverses and round-trip is testable.

## Considered options

- **Add a background worker now (Celery/RQ/django-q).** Rejected for this phase:
  robust for any size but adds a broker + worker service and ops burden to a beta
  stack. Revisit if the cap bites.
- **Atomic all-or-nothing, or strict zero-error commit.** Rejected: real historical
  files always have a few bad rows; blocking the whole import on them (or forcing a
  fix-and-retry before anything lands) is worse UX than preview + commit-valid +
  report, given dedup makes re-import safe.
- **Require Beringer/Stationen to pre-exist (error on unknown).** Rejected as the
  default: it front-loads manual setup before a first backfill. Auto-create +
  surface-in-preview is lower friction; the cost is possible messy stations from
  inconsistent file metadata (a known tension with ADR 0011's admin-managed
  stations), accepted because the preview makes every creation visible.
- **Import-only authentic IWM (leave export divergent), or accept both formats.**
  Rejected in favour of aligning the export: one canonical format beats format drift
  or a dual-dialect parser with `1`-is-it-a-code ambiguity.
- **Keep import as the ADR-0012 migration.** Rejected — see ADR 0012; a migration
  can't serve every org's ongoing imports.

## Consequences

- New multipart, Admin-only endpoint on `ProjectViewSet` (+ `MultiPartParser`); a
  two-call flow (dry-run report, then commit) or one endpoint with a `commit` flag.
- A defined **report schema** (importable / to-create / duplicates / errors /
  warnings) shared by the API and the *Letzte Fänge* dialog.
- **The export format changes** (Geschlecht → letters, etc.): `iwm_export.py` and its
  tests are updated; any consumer of the old integer output is affected. Round-trip
  (export → import) becomes a testable invariant.
- The row **cap** means large one-time backfills run via the management command, not
  the button — a documented limitation, not silent truncation (over-cap uploads are
  rejected with guidance).
- The demo Referenzprojekt seed (ADR 0012) is now just the first caller of this
  service; the sample generator's `sample_iwm_illmitz.xlsx` doubles as an
  import-feature test fixture.
- Ring get-or-create stays org-scoped (ADR 0006); a Wiederfang reuses the existing
  Ring.
