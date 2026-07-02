---
status: accepted
---

# Dashboard statistics are served online-only via a backend aggregation endpoint

## Context

The app is deliberately **offline-first** for data *entry*: a Beringer at a
Station keeps working with no network, reading from an IndexedDB reference cache
and queueing captures locally (PRD #152; see the Offline / nicht synchronisiert /
Offline-Bereitschaft glossary entries and ADR 0015). The Visualisierung feature's
audience explicitly includes those same field Beringer.

But the dashboard is an *analysis* surface, and analysis fights offline:

- Aggregations span the whole project — häufigste Arten over a range, species-
  per-day series, strongest hour of the last Fangtag. The Referenzprojekt alone
  holds thousands of captures.
- The capture list API is paginated at **max 100 rows/page**, and there is **no
  stats endpoint** today. Aggregating client-side would mean pulling *every*
  capture to the device and reimplementing grouping/counting in TypeScript —
  heavy, slow, and duplicated logic that does not scale.
- The counts also need timezone-correct bucketing (`TIME_ZONE = Europe/Vienna`,
  `USE_TZ = True`; timestamps stored UTC). Grouping by day and extracting the
  strongest hour is naturally a SQL job (`TruncDay`/`ExtractHour` with `tzinfo`),
  not a device-side one.

## Decision

Serve the dashboard from a **new online-only backend stats endpoint** under
`/api/birds/`, aggregating in SQL, org-scoped via `active_organization` and
scoped to one Projekt + date range per request. The dashboard **does not work
offline**: with no network it shows a "needs connection" state, the same posture
the IWM export already takes. Aggregation lives on the server; the client only
renders.

## Considered options

- **Client-side aggregation from the offline cache.** Would keep the dashboard
  alive at the Station and naturally include not-yet-synced captures. Rejected:
  it forces pulling all captures past a 100/page limit, reimplements counting in
  TS, and does not scale to large projects — a lot of complexity to make an
  analysis view work in a context where analysis is rarely done.
- **Hybrid: online charts + a client-side "Letzter Tag" card** computed from the
  already-cached today/session entries so the field-relevant tile survives
  offline. A reasonable phase-2 enhancement, but rejected for v1 as extra surface
  before the online path has proven out.

## Consequences

- This is a **deliberate exception to the app's offline-first stance**, which is
  exactly why it is recorded: a future reader seeing an offline-first app will
  reasonably wonder why one feature requires connectivity, and this ADR is the
  answer (analysis-not-field-surface + aggregation-at-scale vs pagination).
- The endpoint follows existing DRF conventions (org-scoped `get_queryset`
  pattern; the `OfflineBundleView` `APIView` and the `next-number` `@action` are
  the precedents for a composite, aggregate response spanning models).
- If field-side offline stats are later wanted, the reversal path is the hybrid
  option above (cache-computed cards), not making the whole aggregation endpoint
  offline-capable.
