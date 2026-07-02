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
 */
@Injectable({providedIn: 'root'})
export class OutboxStoreService {
  private readonly db = inject(IndexedDbStore);

  add(entry: OutboxEntry): Promise<void> {
    return this.db.put('outbox', entry.id, entry);
  }

  /**
   * Every queued entry, oldest-first (capture order) — the order issue
   * #161's sync replays entries in.
   */
  async list(): Promise<OutboxEntry[]> {
    const entries = await this.db.getAll<OutboxEntry>('outbox');
    return entries.slice().sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  }
}
