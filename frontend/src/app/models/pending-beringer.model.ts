/**
 * A no-account Beringer quick-added while offline (issue #167, PRD #152): the
 * "helper who shows up unannounced at a remote Station" (ADR 0001) gets a name
 * + Kürzel captured on-device so they can be selected in the same session's
 * captures before any connectivity exists to create them server-side.
 *
 * `id` is a client-generated placeholder UUID that stands in for the real
 * `Scientist.id` everywhere until sync: dependent captures store it as their
 * `staff_id`, and the sync replay (issue #161, extended by #167) creates the
 * Beringer first, then rewrites those captures' `staff_id` to the real server
 * id it comes back with — whether the Beringer was newly created or matched by
 * Kürzel to one already created server-side in the meantime.
 *
 * `accountKey` is the same tenancy boundary the outbox uses
 * (`OutboxEntry.accountKey`): the single `pendingBeringer` IndexedDB store is
 * shared by every account that has ever used this device, so each queued
 * Beringer records which Mitglied's session added it and is only ever listed,
 * selected or synced under that account.
 */
export interface PendingBeringer {
  id: string;
  accountKey: string;
  first_name: string;
  last_name: string;
  // The Kürzel — the key the server matches against on sync so an existing
  // Beringer is reused rather than duplicated (issue #167).
  handle: string;
  // ISO 8601 timestamp of when the Beringer was quick-added — the order sync
  // replays them in, mirroring the outbox's own `queuedAt`.
  queuedAt: string;
}
