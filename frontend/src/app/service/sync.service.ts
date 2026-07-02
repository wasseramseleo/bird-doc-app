import {inject, Injectable, signal} from '@angular/core';
import {firstValueFrom, from, Observable, of, tap} from 'rxjs';

import {ApiService} from './api.service';
import {AuthService} from './auth.service';
import {OutboxService} from './outbox.service';
import {PendingBeringerService} from './pending-beringer.service';
import {OutboxStoreService} from '../core/offline/outbox-store';
import {OutboxEntry} from '../models/outbox-entry.model';
import {PendingBeringer} from '../models/pending-beringer.model';

/**
 * The outcome of one `syncNow()` run — how many of the account's queued
 * entries were durably synced out of how many were attempted. `total === 0`
 * means there was nothing to do (no account, nothing queued, or the CSRF
 * refresh itself never reached the server); `synced < total` is a partial
 * completion — the sync was interrupted (e.g. connectivity dropped
 * mid-replay) and the remaining entries are still safely queued for the
 * next attempt.
 */
export interface SyncResult {
  readonly total: number;
  readonly synced: number;
}

const NOTHING_TO_SYNC: SyncResult = {total: 0, synced: 0};

/**
 * Drains the offline outbox to the server (issue #161, PRD #152): the
 * counterpart to #160's durable, offline-only outbox — this is what
 * actually replays it once connectivity is (or might be) back.
 *
 * - **Account-keyed**: reads through `OutboxStoreService.listForAccount()`
 *   (never the raw, every-account `list()`), scoped to
 *   `AuthService.currentUser()`, so a shared/offline device can never
 *   replay — or even look at — a different Mitglied's queued captures.
 * - **CSRF-fresh**: fetches a new CSRF token (`AuthService.refreshCsrfToken()`)
 *   before the first replay POST, since a device that was offline for up to
 *   two weeks may be holding an expired cookie.
 * - **Beringer-before-captures (issue #167)**: no-account Beringer quick-added
 *   while offline are created FIRST, before any dependent capture, so those
 *   captures can be replayed with a real `staff_id`. Each create is idempotent
 *   by Kürzel server-side, so a Beringer already created online (or a retried
 *   sync of this one) is matched, not duplicated; the dependent captures'
 *   placeholder `staff_id` is durably rewritten to the returned real id before
 *   they replay. A Beringer failure stops the whole sync before any capture.
 * - **Ordered**: entries are replayed oldest-first (the order
 *   `OutboxStoreService.listForAccount()` already returns them in — capture
 *   order), one at a time.
 * - **Idempotent / interruption-safe**: each entry carries its own
 *   idempotency UUID (#155) end-to-end. Replay stops at the first entry that
 *   fails (rather than skipping ahead — skip-and-flag rejection handling is
 *   #152's next slice, out of scope here) so the still-queued remainder is
 *   untouched and simply retried, under the same key, by the next
 *   `syncNow()` call — never duplicated server-side.
 * - **Account-switch-safe mid-replay**: `AuthService.currentUser()` is a
 *   live, session-cookie-backed signal — it can change *during* the
 *   `await`-per-entry loop (a shared/offline device where Mitglied B logs in,
 *   including from another tab, while A's queue is still replaying). The
 *   loop re-checks it before every entry and aborts — leaving the remainder
 *   queued, exactly like the stop-on-failure path — the moment it no longer
 *   matches the `accountKey` this run started with, so a mid-flight switch
 *   can never have the rest of A's captures POSTed and attributed to B's
 *   session/organization.
 * - Only entries that are actually confirmed synced (the POST succeeded
 *   *and* the local dequeue landed) are removed from the outbox, via
 *   `OutboxService.dequeue()` — which keeps `OutboxService.pendingCount`
 *   (and so the nav bar's always-visible pending count) reactively current.
 *
 * Concurrency: a `syncNow()` call while one is already running is a no-op
 * (resolves to a zero/zero result) rather than racing a second replay of
 * the same entries — callers (auto-triggers on app start / connectivity
 * restored, and the manual "Jetzt synchronisieren" action) can all call it
 * freely without coordinating among themselves.
 */
@Injectable({providedIn: 'root'})
export class SyncService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly outbox = inject(OutboxService);
  private readonly pendingBeringer = inject(PendingBeringerService);
  private readonly outboxStore = inject(OutboxStoreService);

  private readonly syncingState = signal(false);
  readonly syncing = this.syncingState.asReadonly();

  syncNow(): Observable<SyncResult> {
    if (this.syncingState()) {
      return of(NOTHING_TO_SYNC);
    }
    const accountKey = this.auth.currentUser()?.username ?? null;
    if (accountKey === null) {
      return of(NOTHING_TO_SYNC);
    }

    this.syncingState.set(true);
    return from(this.runSync(accountKey)).pipe(tap(() => this.syncingState.set(false)));
  }

  private async runSync(accountKey: string): Promise<SyncResult> {
    try {
      const beringer = await this.pendingBeringer.listOwnQueued();
      let entries = await this.outboxStore.listForAccount(accountKey);
      if (beringer.length === 0 && entries.length === 0) {
        return NOTHING_TO_SYNC;
      }

      // Fetched once per sync run, immediately before the first replay POST
      // (Beringer or capture) — never per-entry — since one fresh cookie is
      // valid for the whole replay.
      await firstValueFrom(this.auth.refreshCsrfToken());

      // Phase 1 (issue #167): create the quick-added no-account Beringer FIRST,
      // before any dependent capture, so those captures can be replayed with a
      // real `staff_id`. Each create is idempotent by Kürzel server-side, so a
      // Beringer someone else already created online (or a retried sync of this
      // very one) is matched, not duplicated — the returned id is the real one
      // either way. The dependent captures' placeholder `staff_id` is durably
      // rewritten to it, then the Beringer is dequeued. A failure here (or an
      // account switch) stops the whole sync before any capture is POSTed —
      // everything stays queued for the next attempt.
      for (const pending of beringer) {
        if (this.auth.currentUser()?.username !== accountKey) {
          console.warn('Aborting outbox sync: active account changed mid-replay; remaining entries stay queued');
          return {total: entries.length, synced: 0};
        }
        const realId = await this.syncBeringer(pending);
        if (realId === null) {
          return {total: entries.length, synced: 0};
        }
        await this.outbox.rewriteStaffId(pending.id, realId);
        await this.pendingBeringer.dequeue(pending.id);
      }

      // Re-read so the phase-1 `staff_id` rewrites are reflected in the payloads
      // about to be replayed.
      entries = await this.outboxStore.listForAccount(accountKey);

      // Phase 2: replay the captures (oldest-first), staff_id now resolved.
      let synced = 0;
      for (const entry of entries) {
        if (this.auth.currentUser()?.username !== accountKey) {
          // The active account changed mid-replay (a shared/offline device
          // where another Mitglied logged in — even from another tab, since
          // the session cookie is shared). The remaining entries are still
          // this run's `accountKey`'s payloads: abort rather than let them
          // be POSTed and silently attributed to the new session/org, and
          // leave them queued for that account's own next sync.
          console.warn('Aborting outbox sync: active account changed mid-replay; remaining entries stay queued');
          break;
        }
        const ok = await this.syncEntry(entry);
        if (!ok) {
          break;
        }
        synced++;
      }
      return {total: entries.length, synced};
    } catch (error) {
      // The CSRF refresh (or the initial account-scoped read) itself never
      // reached the server — nothing was attempted, so report it exactly
      // like "nothing to do" rather than a misleading partial failure.
      console.error('Offline outbox sync could not start', error);
      return NOTHING_TO_SYNC;
    }
  }

  /**
   * Creates one quick-added Beringer on the server (issue #167), returning the
   * real (or Kürzel-matched) `Scientist.id` its dependent captures resolve to,
   * or `null` when the create could not proceed (connectivity dropped, or a
   * rejection). A `null` stops the sync before any dependent capture, leaving
   * the Beringer — and its captures — queued for the next attempt, replayed
   * under the same Kürzel (idempotent) so a retry never duplicates it.
   */
  private async syncBeringer(pending: PendingBeringer): Promise<string | null> {
    try {
      const created = await firstValueFrom(
        this.api.createScientist({
          first_name: pending.first_name,
          last_name: pending.last_name,
          handle: pending.handle,
        }),
      );
      return created.id;
    } catch (error) {
      console.error('Failed to sync a quick-added Beringer; it and its captures remain queued', error);
      return null;
    }
  }

  private async syncEntry(entry: OutboxEntry): Promise<boolean> {
    try {
      await firstValueFrom(this.api.createDataEntry(entry.payload));
      await this.outbox.dequeue(entry.id);
      return true;
    } catch (error) {
      // Whatever the cause (connectivity dropped again, a rejection — the
      // skip-and-flag slice isn't built yet), the entry simply stays queued,
      // untouched, under its original idempotency key for the next attempt.
      console.error('Failed to sync a queued capture; it remains queued', error);
      return false;
    }
  }
}
