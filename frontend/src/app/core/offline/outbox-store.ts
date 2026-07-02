import {inject, Injectable} from '@angular/core';

import {OutboxEntry} from '../../models/outbox-entry.model';
import {IndexedDbStore} from './indexed-db-store';

/**
 * The durable offline outbox (issue #160, PRD #152): the pure IndexedDB
 * read/write layer for queued capture-create payloads. One record per
 * queued capture, keyed by its own idempotency UUID (#155) — a resubmit
 * that replays the same key overwrites its own row rather than duplicating
 * it. `OutboxService` is the higher-level orchestrator (the pending-count
 * signal, enqueueing from the data-access facade); sync (issue #161) will
 * read this same store to replay entries in capture order.
 *
 * The underlying `outbox` object store is shared by every account that has
 * ever used this device (there is one IndexedDB per origin, not per
 * account), so `list()` deliberately returns every entry regardless of
 * whose session queued it — callers that must not see another account's
 * entries use `listForAccount()` instead.
 */
@Injectable({providedIn: 'root'})
export class OutboxStoreService {
  private readonly db = inject(IndexedDbStore);

  add(entry: OutboxEntry): Promise<void> {
    return this.db.put('outbox', entry.id, entry);
  }

  /**
   * Every queued entry across every account, oldest-first (capture order).
   * `OutboxService` uses this to build its full local snapshot, which it
   * then filters reactively to the currently authenticated account — see
   * `listForAccount()` for a pre-filtered read.
   */
  async list(): Promise<OutboxEntry[]> {
    const entries = await this.db.getAll<OutboxEntry>('outbox');
    return entries.slice().sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  }

  /**
   * Every queued entry for the given account only, oldest-first (issue #160
   * tenancy fix) — the account-keyed view issue #161's sync replays, so one
   * account's queue is structurally never visible to, or replayable under,
   * another.
   */
  async listForAccount(accountKey: string): Promise<OutboxEntry[]> {
    const entries = await this.list();
    return entries.filter((entry) => entry.accountKey === accountKey);
  }

  /**
   * Removes a queued entry permanently — once it has been durably synced to
   * the server (issue #161's sync replay) or deleted on-device (issue #163:
   * removing a nicht synchronisiert entry from "today's session"). Keyed the
   * same way as `add()`; removing an id that was never queued is a harmless
   * no-op.
   */
  remove(id: string): Promise<void> {
    return this.db.delete('outbox', id);
  }
}
