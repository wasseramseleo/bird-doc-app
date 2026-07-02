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
 *
 * `accountKey` is a tenancy boundary, not metadata: the single `outbox`
 * IndexedDB store is shared by every account that has ever used this
 * device, so every entry must record which Mitglied's session queued it.
 * `OutboxService` uses it to scope the pending count (and, later, issue
 * #161's sync replay) to the currently authenticated account only — so a
 * different Mitglied logging in on the same shared/offline device never
 * inherits, sees, or (once #161 lands) syncs another account's queued
 * captures under their own session/Organisation.
 */
export interface OutboxEntry {
  id: string;
  // The `AuthUser.username` of the Mitglied whose session queued this entry
  // — see the tenancy note above.
  accountKey: string;
  payload: Record<string, unknown>;
  // ISO 8601 timestamp of when the entry was queued — the capture order that
  // issue #161's sync replays entries in.
  queuedAt: string;
  // The server's rejection message when a sync attempt was refused (issue
  // #164, PRD #152): the entry is left in the queue, flagged with this
  // message, while the rest of the queue syncs on. Absent/`null` means the
  // entry is not flagged — a plain nicht synchronisiert capture still awaiting
  // its first (or a retried) sync. A flagged entry is skipped by the replay
  // until it is fixed in the normal capture form, which re-queues it clean
  // (clearing this flag) — resolving a sync error is just ordinary editing.
  syncError?: string | null;
}
