import {inject, Injectable} from '@angular/core';

import {PendingBeringer} from '../../models/pending-beringer.model';
import {IndexedDbStore} from './indexed-db-store';

/**
 * The durable queue of no-account Beringer quick-added while offline (issue
 * #167, PRD #152): the pure IndexedDB read/write layer, keyed by the Beringer's
 * client-generated placeholder id (the id dependent captures reference until
 * sync). Mirrors `OutboxStoreService`: `PendingBeringerService` is the
 * higher-level orchestrator (the selectable-placeholder signal, enqueueing from
 * the data-access facade), and sync (issue #161, extended by #167) reads this
 * same store to create the Beringer before its dependent captures.
 *
 * The underlying `pendingBeringer` object store is shared by every account that
 * has ever used this device, so `list()` deliberately returns every entry
 * regardless of whose session queued it — callers that must not see another
 * account's Beringer use `listForAccount()` instead.
 */
@Injectable({providedIn: 'root'})
export class PendingBeringerStoreService {
  private readonly db = inject(IndexedDbStore);

  add(entry: PendingBeringer): Promise<void> {
    return this.db.put('pendingBeringer', entry.id, entry);
  }

  /** Every quick-added Beringer across every account, oldest-first (quick-add
   * order — the order sync creates them in). */
  async list(): Promise<PendingBeringer[]> {
    const entries = await this.db.getAll<PendingBeringer>('pendingBeringer');
    return entries.slice().sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  }

  /** Every quick-added Beringer for the given account only, oldest-first — the
   * account-keyed view sync creates them from, so one account's queue is never
   * visible to, or synced under, another. */
  async listForAccount(accountKey: string): Promise<PendingBeringer[]> {
    const entries = await this.list();
    return entries.filter((entry) => entry.accountKey === accountKey);
  }

  /** Removes a quick-added Beringer permanently — once it has been created (or
   * Kürzel-matched) on the server by the sync replay (issue #167). Removing an
   * id that was never queued is a harmless no-op. */
  remove(id: string): Promise<void> {
    return this.db.delete('pendingBeringer', id);
  }
}
