---
status: accepted
---

# The replay path is lenient: stamped payloads, always accepted, flagged only on validation

## Context

`OutboxEntry.payload` is `Record<string, unknown>`, captured **verbatim** — the model
docstring says "the exact payload `DataEntryFormComponent` would otherwise have
POSTed… captured verbatim so a later slice can replay it unchanged". Nothing stamps
it: `frontend/src` has no `schemaVersion`, `payloadVersion` or `appVersion` anywhere
(issue #408). `OFFLINE_DB_VERSION` versions the *database schema*, never the *content*
of a record.

**A payload's format is therefore frozen at queue time, and IndexedDB outlives any
bundle swap.** This is the fact the whole decision turns on, and it is what makes
ADR 0032 (`SwUpdate`) irrelevant here in either ordering: replay after adopting a new
Version and the *same* month-old payload arrives; replay before, and sync has already
fired on `window 'online'` (`outbox-indicator.ts:67`) with the old bundle. The queued
payload never changes. A device offline ~30 days (`sync.service.ts:200-201`, issue
#165) replays against today's contract with nothing detecting the drift.

Meanwhile every 4xx on replay is treated as a definitive rejection
(`sync.service.ts:285-287`) and gets skip-and-flag: the entry stays in IndexedDB,
flagged, **skipped by every later replay** (`:132-134`), until the Beringer re-opens
and re-saves it by hand. That is right for a validation refusal (issue #164) and wrong
for everything else — a 403 from a CSRF refusal mid-run permanently flags real field
data for a transient condition, and a per-entry 401 never reaches the run-level
`isSessionExpired` handler at all, because `syncEntry` catches its own errors
(issue #409).

## Decision

The replay path is **lenient**, extending ADR 0031's instinct — *never blame the field
for what the system did* — from vocabulary to the whole contract.

1. **Stamp a payload schema version, not a build version.** A build version churns on
   every release and would make every payload look drifted; a schema version rises
   **only** on a contract change, so `schemaVersion === current` is a meaningful
   all-clear. An absent stamp means the pre-versioning contract.
2. **Migration is server-side.** Not a preference — the client option is **impossible**:
   the bundle replaying a June payload *is* the June bundle, and it cannot migrate
   June→July because it predates July and has never heard of it. Only the server knows
   what the contract became. (Force-adopting a new Version before replay would dodge
   this, and ADR 0032 forbids it.)
3. **A payload too old to migrate is always accepted — never rejected.** The server
   answers 200, the entry dequeues, nothing strands, nothing loops. But it is **not
   admitted to the Fangdaten**: the raw payload is stored verbatim with its
   `schemaVersion` and an Admin is alerted. The server by definition does not know what
   an unmigratable payload means — that is what "too old" *is* — so writing it into the
   scientific record would put possibly-misinterpreted measurements on their way to the
   Zentrale, indistinguishable from good rows.
4. **Flagging is earned, not assumed.** Only **400/422** — a refusal of the payload on
   its own merits — produces a Synchronisierungsfehler. Every other 4xx is a condition
   of the **run**:

   | status | outcome |
   |---|---|
   | 400 / 422 | skip-and-flag (unchanged; issue #164) |
   | 401 / 403 | abort run, re-login / CSRF refresh |
   | 404 | abort run, flip Offline-Bereitschaft to stale (see below) |
   | 429 | abort run, honour `Retry-After` if present |
   | anything else | abort run |

5. **A 404 on replay means drift, and is never per-entry.** DRF's `ModelViewSet.create`
   never calls `get_object` and a bad FK surfaces as 400, so a 404 means one thing: this
   bundle is POSTing to an endpoint the server no longer has. That is *systemic* — every
   queued entry would 404 — so flagging would condemn a Beringer's whole trip for a
   deploy. It aborts the run and tells ADR 0032's indicator the Version is stale.

## Consequences

- **The holding area in (3) is unreachable by construction**, because ADR 0031's
  invariant keeps every alias alive at least as long as the outbox retains a payload. It
  is an **alarm with a data attachment, not a workflow** — if it ever fires, someone
  dropped an alias early or grew the outbox's retention. Keep it that small; building it
  into a queue with a UI would be designing for a bug.
- **It is deliberately not a domain term.** No CONTEXT.md entry: it follows the house
  instinct that already refuses to name the outbox ("the underlying local hold-area is
  deliberately **not** given a first-class domain name"). Admin-facing, near-empty,
  implementation detail.
- **A genuinely bad payload answering some *other* 4xx now retries forever** instead of
  flagging once. This is the honest cost of inverting the default. Today the case looks
  empty — 409 is unreachable on the replay path (all three sites are the invitation seat
  limit and two DELETE routes) and the ring-uniqueness collision is already a 400
  (`capture_service.py:23`) — but a future endpoint could reintroduce it, and then this
  needs revisiting rather than patching around.
- **429 is unreachable today** — `REST_FRAMEWORK` (`settings.py:121-130`) configures no
  throttle classes and ADR 0007 removed Cloudflare, so only nginx could emit one. The
  allowlist covers it for free, which is why it needed no separate design.
- **`Synchronisierungsfehler` now denotes something narrower** — a validation refusal
  only — and CONTEXT.md says so.
- Stamping the payload is itself a contract change, so it has to tolerate its own
  absence from day one.

## Considered options

- **Migrate on the client at replay** — rejected as impossible; see Decision (2).
- **Stamp the app/build version** — rejected: it rises when nothing about the payload
  changed, so it cannot answer "has this payload drifted?" without a lookup table of
  which builds changed the contract, which is the schema version wearing a disguise.
- **Reject a payload that is too old to migrate** — rejected: it is the ADR 0031 trap
  exactly. A rejection is skip-and-flag, which strands a real capture and blames the
  Beringer for the bundle we shipped him.
- **Accept a too-old payload straight into the Fangdaten, flagged** — rejected: from the
  device's side it is identical to (3), but it writes data the server admits it cannot
  interpret into the scientific record. A wrong Flügellänge is worse than a missing one,
  and it looks like every other row.
- **Enumerate each status individually** (#409's original proposal) — rejected in favour
  of the allowlist. Every specific fix it proposed was the same complaint — the catch-all
  sits on the wrong side. Flagging is the one outcome costing a human manual work per
  entry; it should require positive evidence, not be what happens when we fail to
  recognise a status.
- **Wait for ADR 0032 and skip this** (#408's own open question, "lohnt sich das
  eigenständig?") — rejected: an update prompt cannot touch a payload frozen at queue
  time. This is the *only* one of the three issues that defends the replay path.

## See also

- **ADR 0031** — the vocabulary case this generalises, and the alias-retention invariant
  that makes (3) unreachable.
- **ADR 0032** — the other window, and why it is not a substitute for this one.
- The **Synchronisierungsfehler** and **nicht synchronisiert** entries in CONTEXT.md.
