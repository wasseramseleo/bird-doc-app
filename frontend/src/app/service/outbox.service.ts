import {computed, inject, Injectable, signal} from '@angular/core';
import {from, Observable, tap} from 'rxjs';

import {OutboxEntry} from '../models/outbox-entry.model';
import {OutboxStoreService} from '../core/offline/outbox-store';
import {AuthService} from './auth.service';

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
 *
 * Tenancy (issue #160 fix): the single `outbox` IndexedDB store is shared by
 * every account that has ever used this device, so `entries` (loaded from
 * `OutboxStoreService.list()`) may hold more than one account's rows.
 * `pendingCount` and `enqueue()` both scope to `AuthService.currentUser()`
 * — reactively, not just at construction — so handing a shared/offline
 * device to a different Mitglied (logout, then a fresh login, with no
 * reload in between) never shows or grows another account's queue.
 */
@Injectable({providedIn: 'root'})
export class OutboxService {
  private readonly store = inject(OutboxStoreService);
  private readonly auth = inject(AuthService);

  private readonly entries = signal<OutboxEntry[]>([]);

  private readonly currentAccountKey = computed<string | null>(
    () => this.auth.currentUser()?.username ?? null,
  );

  readonly pendingCount = computed(() => {
    const accountKey = this.currentAccountKey();
    if (accountKey === null) {
      return 0;
    }
    return this.entries().filter((entry) => entry.accountKey === accountKey).length;
  });

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
   * UUID (#155) so the same failed create can never be queued twice, and by
   * the currently authenticated account (issue #160 tenancy fix) so it can
   * never be counted or, later, synced (#161) under a different Mitglied's
   * session. The returned observable completes once the write to IndexedDB
   * has landed — callers must not treat the capture as safely captured
   * before that.
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
    const accountKey = this.currentAccountKey();
    if (!accountKey) {
      throw new Error('Cannot enqueue a capture without an authenticated account.');
    }
    const entry: OutboxEntry = {id, accountKey, payload, queuedAt: new Date().toISOString()};
    return from(this.ready.then(() => this.store.add(entry))).pipe(
      tap(() => this.entries.update((current) => [...current, entry])),
    );
  }

  /**
   * Durably drops a queued entry once it has been synced to the server
   * (issue #161's sync replay), keeping the in-memory `entries` — and so
   * `pendingCount` — in sync with the durable store the moment the write
   * lands. Waits for `ready` first, for the same reason `enqueue()` does: a
   * dequeue racing the initial `restore()` read must never let the stale
   * read silently resurrect an entry that was just removed.
   */
  async dequeue(id: string): Promise<void> {
    await this.ready;
    await this.store.remove(id);
    this.entries.update((current) => current.filter((entry) => entry.id !== id));
  }
}
