/**
 * A durable, queued capture-create attempt (issue #160, PRD #152): the exact
 * payload `DataEntryFormComponent` would otherwise have POSTed to
 * `/data-entries/`, captured verbatim so a later slice (issue #161) can
 * replay it unchanged once connectivity returns.
 *
 * `id` is the capture's own idempotency UUID (#155) — the same key already
 * embedded in `payload.idempotency_key` — so an entry can never be queued
 * twice under two different ids, and a resubmit of the same failed create
 * simply overwrites its own outbox row instead of duplicating it.
 */
export interface OutboxEntry {
  id: string;
  payload: Record<string, unknown>;
  // ISO 8601 timestamp of when the entry was queued — the capture order that
  // issue #161's sync replays entries in.
  queuedAt: string;
}
