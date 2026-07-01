---
status: accepted
---

# Demo Referenzprojekt as a de-identified, unmarked real tenant

## Context

We need a **Referenzprojekt** (see `CONTEXT.md`) — a demo dataset that serves three
jobs: onboarding new users, generating marketing visualisations, and exercising
features against realistic content. The data foundation is a real IWM export
(`Datenmeldung`-format `.xlsx`, several hundred captures) provided by a real
ringing operation.

Two constraints collide. The app is strictly **multi-tenant** (ADR 0005): every
capture, Ring, Station and Projekt belongs to exactly one **Organisation**, and
every queryset is scoped to the requester's Mitgliedschaft. So demo content can
only live *inside an Organisation* — there is no "global demo" shelf. And the
source is **real catch data**: under DSGVO the Beringer are personal data, and the
provider's dataset (rings, sites, dates, biometrics) must not be recognisable or
reconstructable from what we publish. The demo captures must therefore be
*plausible but non-real* — explicitly **not Fangdaten**.

There is no IWM **import** path today (only the export, ADR 0002 / `iwm_export.py`).
Rather than build a one-off seed loader, import has been promoted to a first-class,
in-app feature — Org-Admins import existing ringing data from an IWM sheet into a
selected Projekt (ADR 0013). The Referenzprojekt is seeded by **using that same
import service**, so the demo dogfoods the feature.

This ADR covers **Phase 1** — seeding the backend tenant. The public,
no-account, browser-ephemeral demo *mode* (Phase 2) is deliberately out of scope
here and will get its own ADR.

## Decision

Seed a single demo tenant — Organisation **BirdDoc Demo** (handle `BDDEMO`) with
one Projekt, one Station and two Beringer — from the real export, transformed to
be **unlinkable**, and load it by **importing the anonymised file through the
app's IWM import service** (ADR 0013), invoked by a management command.

- **Unlinkable de-identification.** A deterministic anonymiser transforms every
  reality-linking field so no seeded row matches a real capture: real Beringer and
  Stationen collapse (consistent many-to-one) onto a small **curated cast** — one
  Admin-with-account (the marketing/test login) and one no-account helper, one
  Station; ring numbers are renumbered into a demo range; capture dates are
  shifted by whole years into a recent window (month/day and
  Erstfang→Wiederfang ordering preserved); biometrics are jittered within
  per-species plausible ranges; free-text Bemerkungen are dropped (Aves ignota
  keeps a generic placeholder, since its Bemerkung is mandatory). Sonderarten
  (Ring vernichtet, Aves ignota) are preserved with their invariants. A bird's
  Wiederfang keeps its Erstfang's remapped Ring identity and stays later in time;
  Ring size stays consistent with species (ADR 0006).
- **The real Excel never enters the repo.** The maintainer runs the anonymiser
  locally and commits only the safe `demo_iwm.xlsx`, which is non-personal.
- **Seed via the import service, not a migration.** The anonymised `demo_iwm.xlsx`
  is loaded by the same IWM import service the app exposes to Org-Admins (ADR 0013),
  invoked by a `seed_demo_org` management command (idempotent, re-runnable for
  local / staging / prod). No data migration carries the content — an earlier plan
  to auto-apply it via a `RunPython` migration was dropped when import became a
  first-class feature (ADR 0013).
- **No schema marker.** BirdDoc Demo is an ordinary Organisation. Real Mitglieder
  never see it because they hold no Mitgliedschaft in it (ADR 0005); any code that
  must single it out keys off the known handle `BDDEMO`.

## Considered options

- **`is_demo` flag on Organization.** Rejected (for now): no operator dashboard,
  billing, or metric yet exists that would need to exclude it, so the flag would
  be dead weight (YAGNI). The cost is that a *future* aggregate must remember to
  exclude the `BDDEMO` handle itself.
- **Strip identifiers only** (rename Beringer, keep real rings/dates/coords/
  biometrics). Rejected: every row would still be a real capture record — the
  provider could recognise their own dataset, and real coordinates could expose
  real (possibly protected) sites.
- **Faithful 1:1 remap** of all ringers/stations. Rejected in favour of a curated
  minimal cast: cleaner, controllable marketing story, and the flattened
  per-entity density is acceptable for a demo.
- **Synthetic augmentation / fully synthetic data.** Rejected: the provided real
  distribution, once de-identified, is realistic enough; generating birds from
  scratch is more work and less convincing.
- **A thin `RunPython` data migration carrying the seed** (the original plan).
  Superseded: once import became an in-app feature (ADR 0013), routing the demo
  seed through the same service via a `seed_demo_org` command is more reuse for
  less code than a bespoke migration, and keeps hundreds of content rows out of the
  migration graph. **Fixtures (`loaddata`)** were also rejected — they bypass the
  ring/serializer logic (ring linkages would be hand-baked) and add a second data
  format.

## Consequences

- The demo rides the app's **IWM import service** (ADR 0013) rather than any
  bespoke loader — the same parse / validate / create path real Org-Admins use, so
  the demo continuously exercises it. That importer is also reusable for generating
  the Phase-2 client-side demo snapshot from the same anonymised source.
- The demo Admin account is a real `User` with an Admin Mitgliedschaft in
  BirdDoc Demo; its prod password is set as a secret after seeding (never
  committed). It consumes one Mitgliedsplatz of BirdDoc Demo's own Seat-Limit.
- Because there is no marker, any future operator-facing metric that counts
  Organisations must exclude the `BDDEMO` handle explicitly, or it will report a
  phantom tenant.
- The seed is idempotent, so developers get the Referenzprojekt locally via
  `seed_demo_org` — feature-testing runs against the same content as marketing.
- Phase 2 (public no-account demo mode, browser-ephemeral edits) is unaddressed
  here and remains a separate, larger decision.
