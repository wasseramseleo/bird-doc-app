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
/**
 * The payload contract the current bundle speaks (issue #408, ADR 0033).
 *
 * A **payload schema version, not a build version**: a build version churns on
 * every release, which would make every queued payload look drifted and could
 * only answer "has this payload drifted?" through a lookup table of which builds
 * changed the contract — the schema version wearing a disguise. This rises
 * **only** when the capture-create payload's contract actually changes, which is
 * what makes `schemaVersion === PAYLOAD_SCHEMA_VERSION` a meaningful all-clear.
 *
 * Its counterpart is `PAYLOAD_SCHEMA_VERSION` in `backend/birds/payload_schema.py`,
 * which is what migrates a replayed payload forward: raise the two together, and
 * only ever add the server-side migration step — the client cannot migrate at
 * all, since the bundle replaying a June payload *is* the June bundle and has
 * never heard of July.
 *
 * Deliberately not `OFFLINE_DB_VERSION` (`core/offline/indexed-db-store.ts`),
 * which versions the IndexedDB *schema* — the shape of the box — never the
 * *content* of the record inside it.
 */
export const PAYLOAD_SCHEMA_VERSION = 1;

export interface OutboxEntry {
  id: string;
  // The `AuthUser.username` of the Mitglied whose session queued this entry
  // — see the tenancy note above.
  accountKey: string;
  payload: Record<string, unknown>;
  // ISO 8601 timestamp of when the entry was queued — the capture order that
  // issue #161's sync replays entries in.
  queuedAt: string;
  // The payload contract the queueing bundle spoke (issue #408, ADR 0033), frozen
  // with the payload itself: `payload` is captured verbatim at queue time and
  // IndexedDB outlives any bundle swap, so a device offline ~30 days replays a
  // month-old contract with nothing else able to detect the drift. `SyncService`
  // puts it on the wire and the server migrates forward from it.
  //
  // Optional, and absent means the **pre-versioning contract** — not "unknown".
  // Stamping is itself a contract change, so it must tolerate its own absence
  // from day one: every entry already queued on a real device when this ships
  // carries no stamp, and those are exactly the captures the stamp exists to
  // protect. Never backfill one onto them — the bundle that froze that payload
  // made no claim about its contract, and the server reads it as precisely that.
  schemaVersion?: number;
  // The server's rejection message when a sync attempt was refused (issue
  // #164, PRD #152): the entry is left in the queue, flagged with this
  // message, while the rest of the queue syncs on. Absent/`null` means the
  // entry is not flagged — a plain nicht synchronisiert capture still awaiting
  // its first (or a retried) sync. A flagged entry is skipped by the replay
  // until it is fixed in the normal capture form, which re-queues it clean
  // (clearing this flag) — resolving a sync error is just ordinary editing.
  syncError?: string | null;
}
