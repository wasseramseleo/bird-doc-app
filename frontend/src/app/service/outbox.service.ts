import {computed, inject, Injectable, signal} from '@angular/core';
import {from, Observable, tap} from 'rxjs';

import {OutboxEntry} from '../models/outbox-entry.model';
import {OutboxStoreService} from '../core/offline/outbox-store';
import {AuthService} from './auth.service';

/**
 * The offline outbox's pending-entries state (issue #160, #163, PRD #152,
 * CONTEXT.md's **nicht synchronisiert** glossary entry): how many — and
 * which — captures are durably queued in IndexedDB, still waiting to reach
 * the server. `DataAccessFacadeService` enqueues here whenever a create
 * falls back to the outbox; `OutboxIndicator` (nav bar) reads `pendingCount`
 * for the always-visible "N nicht synchronisierte Einträge" indication, and
 * "today's session" (issue #163) reads `pendingEntries()` to list them, plus
 * `findQueued()`/`update()`/`delete()` to open, edit and remove one.
 *
 * The count is restored from IndexedDB on construction (`ready`), so a
 * reload/restart shows the real, durable count immediately rather than a
 * transient zero while the first read is in flight — the same pattern
 * `ReferenceCacheService` uses for its own persisted state.
 *
 * Tenancy (issue #160 fix, extended by #163): the single `outbox` IndexedDB
 * store is shared by every account that has ever used this device, so
 * `entries` (loaded from `OutboxStoreService.list()`) may hold more than one
 * account's rows. `pendingCount`, `pendingEntries()`, `findQueued()`,
 * `enqueue()`, `update()` and `delete()` all scope to
 * `AuthService.currentUser()` — reactively, not just at construction — so
 * handing a shared/offline device to a different Mitglied (logout, then a
 * fresh login, with no reload in between) never shows, grows, edits or
 * deletes another account's queue.
 */
@Injectable({providedIn: 'root'})
export class OutboxService {
  private readonly store = inject(OutboxStoreService);
  private readonly auth = inject(AuthService);

  private readonly entries = signal<OutboxEntry[]>([]);

  private readonly currentAccountKey = computed<string | null>(
    () => this.auth.currentUser()?.username ?? null,
  );

  readonly pendingCount = computed(() => this.pendingEntries().length);

  /**
   * Every entry queued by the currently authenticated account, oldest-first
   * (capture order) — the account-scoped read path "today's session"
   * (issue #163) lists queued entries through, exactly like `pendingCount`
   * above. Never exposes another account's rows on a shared/offline device.
   */
  readonly pendingEntries = computed<OutboxEntry[]>(() => {
    const accountKey = this.currentAccountKey();
    if (accountKey === null) {
      return [];
    }
    return this.entries()
      .filter((entry) => entry.accountKey === accountKey)
      .slice()
      .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
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

  /**
   * The currently authenticated account's own queued entries, oldest-first
   * (issue #162): the read path the offline ring-number suggestion folds in
   * alongside the cached last-consumed number, so back-to-back offline
   * Erstfänge/Ring-vernichtet captures suggest sequential numbers. Goes
   * through `OutboxStoreService.listForAccount()` — the account-scoped read
   * path (issue #160 tenancy fix) — never the raw, unfiltered store, so a
   * shared/offline device never folds another Mitglied's queued captures
   * into this account's suggestion. Resolves to an empty list when no
   * account is authenticated, mirroring `enqueue()`'s own guard.
   */
  async listOwnQueued(): Promise<OutboxEntry[]> {
    const accountKey = this.currentAccountKey();
    if (accountKey === null) {
      return [];
    }
    return this.store.listForAccount(accountKey);
  }

  /**
   * Resolves a queued entry by id, scoped to the currently authenticated
   * account (issue #163: "today's session" navigation resolving both server
   * IDs and local outbox IDs to the same form). Returns `null` for a server
   * id (never queued) exactly the same as for another account's entry — a
   * caller cannot distinguish "not queued" from "not yours", which is the
   * point: a shared/offline device must never leak another Mitglied's queue.
   */
  findQueued(id: string): OutboxEntry | null {
    return this.pendingEntries().find((entry) => entry.id === id) ?? null;
  }

  /**
   * Edits a queued (nicht synchronisiert) entry in place (issue #163):
   * overwrites its payload — e.g. after fixing a typo in the normal capture
   * form — while preserving its id and `queuedAt`, so the correction
   * re-queues under the same idempotency key and in its original capture
   * order rather than jumping to the back of the queue. Only ever targets an
   * entry already visible to the current account via `findQueued()`.
   */
  update(id: string, payload: Record<string, unknown>): Observable<void> {
    const existing = this.findQueued(id);
    if (!existing) {
      throw new Error('Cannot edit an outbox entry that is not queued for the current account.');
    }
    const updated: OutboxEntry = {...existing, payload};
    return from(this.ready.then(() => this.store.add(updated))).pipe(
      tap(() =>
        this.entries.update((current) => current.map((entry) => (entry.id === id ? updated : entry))),
      ),
    );
  }

  /**
   * Deletes a queued (nicht synchronisiert) entry (issue #163) — the only
   * kind of entry that can be removed on-device; an already-synchronisiert
   * entry is read-only and has no delete path here. Only ever targets an
   * entry already visible to the current account via `findQueued()`.
   */
  delete(id: string): Observable<void> {
    const existing = this.findQueued(id);
    if (!existing) {
      throw new Error('Cannot delete an outbox entry that is not queued for the current account.');
    }
    return from(this.ready.then(() => this.store.remove(id))).pipe(
      tap(() => this.entries.update((current) => current.filter((entry) => entry.id !== id))),
    );
  }
}
