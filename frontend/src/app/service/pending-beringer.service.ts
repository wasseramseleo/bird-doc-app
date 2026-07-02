import {computed, inject, Injectable, signal} from '@angular/core';
import {from, map, Observable, tap} from 'rxjs';

import {PendingBeringer} from '../models/pending-beringer.model';
import {Scientist, ScientistCreatePayload} from '../models/scientist.model';
import {PendingBeringerStoreService} from '../core/offline/pending-beringer-store';
import {AuthService} from './auth.service';

/**
 * The offline quick-added-Beringer state (issue #167, PRD #152): the no-account
 * Beringer a Mitglied adds at a remote Station before any connectivity exists
 * to create them server-side (ADR 0001). Mirrors `OutboxService`: it owns the
 * in-memory snapshot of the durable `pendingBeringer` store, restored on
 * construction (`ready`) so a reload/restart keeps the just-added Beringer
 * selectable, and it is account-scoped throughout (the store is shared by every
 * account that has ever used this device).
 *
 * `DataAccessFacadeService` enqueues here whenever a Beringer quick-add falls
 * back offline and folds `pendingScientists()` into the offline Beringer picker;
 * `SyncService` (issue #161, extended by #167) reads `listOwnQueued()` to create
 * each Beringer before its dependent captures and `dequeue()`s it once the real
 * (or Kürzel-matched) server id is known.
 */
@Injectable({providedIn: 'root'})
export class PendingBeringerService {
  private readonly store = inject(PendingBeringerStoreService);
  private readonly auth = inject(AuthService);

  private readonly entries = signal<PendingBeringer[]>([]);

  private readonly currentAccountKey = computed<string | null>(
    () => this.auth.currentUser()?.username ?? null,
  );

  /**
   * The current account's quick-added (not-yet-synced) Beringer, shaped as
   * selectable `Scientist` placeholders (oldest-first) so the offline Beringer
   * picker can fold them in and captures can reference them by their placeholder
   * id in the same session — even across a reload — before they ever reach the
   * server. Never exposes another account's Beringer on a shared/offline device.
   */
  readonly pendingScientists = computed<Scientist[]>(() => {
    const accountKey = this.currentAccountKey();
    if (accountKey === null) {
      return [];
    }
    return this.entries()
      .filter((entry) => entry.accountKey === accountKey)
      .slice()
      .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
      .map(toPlaceholderScientist);
  });

  readonly ready: Promise<void> = this.restore();

  private async restore(): Promise<void> {
    try {
      this.entries.set(await this.store.list());
    } catch (error) {
      console.error('Failed to read the offline quick-added Beringer queue', error);
    }
  }

  /**
   * Durably queues a no-account Beringer quick-added while offline, minting the
   * client placeholder id its dependent captures reference until sync, and
   * stamping it with the currently authenticated account (tenancy). Resolves to
   * the placeholder `Scientist` so the caller can select it into the capture
   * form immediately. Waits for `ready` first, for the same race reason
   * `OutboxService.enqueue()` does.
   */
  enqueue(input: ScientistCreatePayload): Observable<Scientist> {
    const accountKey = this.currentAccountKey();
    if (!accountKey) {
      throw new Error('Cannot quick-add a Beringer without an authenticated account.');
    }
    const entry: PendingBeringer = {
      id: crypto.randomUUID(),
      accountKey,
      first_name: input.first_name,
      last_name: input.last_name,
      handle: input.handle,
      queuedAt: new Date().toISOString(),
    };
    return from(this.ready.then(() => this.store.add(entry))).pipe(
      tap(() => this.entries.update((current) => [...current, entry])),
      map(() => toPlaceholderScientist(entry)),
    );
  }

  /**
   * The current account's own quick-added Beringer, oldest-first — the read
   * path `SyncService` creates them from (issue #167). Goes through the
   * account-scoped store read, never the raw store, so a shared/offline device
   * never syncs another Mitglied's Beringer. Empty when no account is
   * authenticated, mirroring `enqueue()`'s guard.
   */
  async listOwnQueued(): Promise<PendingBeringer[]> {
    const accountKey = this.currentAccountKey();
    if (accountKey === null) {
      return [];
    }
    return this.store.listForAccount(accountKey);
  }

  /**
   * Durably drops a quick-added Beringer once sync has created it (or matched it
   * by Kürzel) on the server (issue #167), keeping the in-memory placeholder
   * list current the moment the write lands. Waits for `ready` first, exactly
   * like `OutboxService.dequeue()`.
   */
  async dequeue(id: string): Promise<void> {
    await this.ready;
    await this.store.remove(id);
    this.entries.update((current) => current.filter((entry) => entry.id !== id));
  }
}

function toPlaceholderScientist(entry: PendingBeringer): Scientist {
  return {
    id: entry.id,
    handle: entry.handle,
    full_name: `${entry.first_name} ${entry.last_name}`.trim(),
  };
}
