import {computed, inject, Injectable, signal} from '@angular/core';
import {from, Observable, tap} from 'rxjs';

import {OutboxEntry} from '../models/outbox-entry.model';
import {OutboxStoreService} from '../core/offline/outbox-store';

/**
 * The offline outbox's pending-count signal (issue #160, PRD #152,
 * CONTEXT.md's **nicht synchronisiert** glossary entry): how many captures
 * are durably queued in IndexedDB, still waiting to reach the server.
 * `DataAccessFacadeService` enqueues here whenever a create falls back to
 * the outbox; `OutboxIndicator` (nav bar) reads `pendingCount` to show the
 * always-visible "N nicht synchronisierte Einträge" indication.
 *
 * The count is restored from IndexedDB on construction (`ready`), so a
 * reload/restart shows the real, durable count immediately rather than a
 * transient zero while the first read is in flight — the same pattern
 * `ReferenceCacheService` uses for its own persisted state.
 */
@Injectable({providedIn: 'root'})
export class OutboxService {
  private readonly store = inject(OutboxStoreService);

  private readonly entries = signal<OutboxEntry[]>([]);
  readonly pendingCount = computed(() => this.entries().length);

  readonly ready: Promise<void> = this.restore();

  private async restore(): Promise<void> {
    try {
      this.entries.set(await this.store.list());
    } catch (error) {
      console.error('Failed to read the offline outbox', error);
    }
  }

  /**
   * Durably queues a capture-create payload, keyed by its own idempotency
   * UUID (#155) so the same failed create can never be queued twice. The
   * returned observable completes once the write to IndexedDB has landed —
   * callers must not treat the capture as safely captured before that.
   *
   * Waits for `ready` first: without that, an enqueue racing the initial
   * `restore()` read (both real, unordered-relative-to-each-other IndexedDB
   * round trips) could have `restore()`'s stale (pre-enqueue) `entries.set()`
   * land *after* this method's own `entries.update()`, silently dropping the
   * just-queued entry from the pending-count signal (the durable IndexedDB
   * row itself would still be safe — only the in-memory count would lie).
   */
  enqueue(payload: Record<string, unknown> & {idempotency_key?: string | null}): Observable<void> {
    const id = payload.idempotency_key;
    if (!id) {
      throw new Error('Cannot enqueue a capture without an idempotency_key.');
    }
    const entry: OutboxEntry = {id, payload, queuedAt: new Date().toISOString()};
    return from(this.ready.then(() => this.store.add(entry))).pipe(
      tap(() => this.entries.update((current) => [...current, entry])),
    );
  }
}
