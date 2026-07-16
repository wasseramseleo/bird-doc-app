import {inject, Injectable, signal} from '@angular/core';
import {HttpErrorResponse} from '@angular/common/http';
import {Router} from '@angular/router';
import {firstValueFrom, from, Observable, of, tap} from 'rxjs';

import {ApiService} from './api.service';
import {AppUpdateService} from './app-update.service';
import {AuthService} from './auth.service';
import {OutboxService} from './outbox.service';
import {PendingBeringerService} from './pending-beringer.service';
import {OutboxStoreService} from '../core/offline/outbox-store';
import {OutboxEntry} from '../models/outbox-entry.model';
import {PendingBeringer} from '../models/pending-beringer.model';

/**
 * The outcome of one `syncNow()` run over the account's *eligible* queued
 * entries — every queued entry except those already flagged with a prior sync
 * rejection (issue #164), which the replay skips until they are fixed. `total`
 * is how many eligible entries were attempted; `synced` how many reached the
 * server durably; `flagged` how many the server rejected this run (left queued,
 * flagged, so the rest could sync on).
 *
 * - `total === 0`: nothing to do (no account, nothing eligible queued, or the
 *   CSRF refresh itself never reached the server).
 * - `synced + flagged === total`: the run reached the end of the queue — every
 *   eligible entry either synced or was flagged.
 * - `synced + flagged < total`: the run was interrupted (e.g. connectivity
 *   dropped mid-replay); the untouched remainder is still safely queued for the
 *   next attempt.
 */
export interface SyncResult {
  readonly total: number;
  readonly synced: number;
  readonly flagged: number;
}

/** One eligible entry's fate during replay. */
type EntryOutcome = 'synced' | 'flagged' | 'interrupted';

const NOTHING_TO_SYNC: SyncResult = {total: 0, synced: 0, flagged: 0};

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
 *   idempotency UUID (#155) end-to-end. A *transient* failure (connectivity
 *   dropped again — `HttpErrorResponse.status === 0` — or a `5xx` server error)
 *   stops the replay at that entry, so the still-queued remainder is untouched
 *   and simply retried, under the same key, by the next `syncNow()` call —
 *   never duplicated server-side.
 * - **Skip-and-flag on a validation rejection (issue #164)**: a **400/422** — a
 *   refusal of the payload on its own merits (a validation change, a Station
 *   archived mid-trip, a Beringer reassigned to the Gelöschter Nutzer, or a
 *   genuine ring-uniqueness collision from a concurrent device) — is not a
 *   transient failure: retrying the same payload will only be refused again.
 *   Rather than let one bad entry hold the whole queue hostage, that entry is
 *   left in the queue, flagged with the server's own error message
 *   (`OutboxService.flag()`), and the replay continues with the rest. A flagged
 *   entry is skipped by later replays until it is fixed in the normal capture
 *   form (`OutboxService.update()` clears the flag) — resolving a sync error is
 *   just ordinary editing.
 * - **Flagging is earned, not assumed (issue #409, ADR 0033)**: only those two
 *   statuses flag. Every *other* refusal the server can answer — an expired
 *   session, a CSRF refusal, a rate limit, a Version so stale the endpoint has
 *   moved — is a condition of the **run**, not of the entry: the run aborts,
 *   leaving the queue completely untouched, and the next sync carries on. A
 *   Synchronisierungsfehler is the one outcome that costs a Beringer manual work
 *   per entry, so it must require positive evidence rather than be the fallback
 *   for a status we failed to recognise.
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
  private readonly router = inject(Router);
  private readonly appUpdate = inject(AppUpdateService);

  private readonly syncingState = signal(false);
  readonly syncing = this.syncingState.asReadonly();

  /** Epoch ms before which no run may start, set only by a 429's `Retry-After`. */
  private retryNotBefore = 0;

  syncNow(): Observable<SyncResult> {
    if (this.syncingState()) {
      return of(NOTHING_TO_SYNC);
    }
    if (Date.now() < this.retryNotBefore) {
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
      // A previously flagged entry (issue #164) is skipped, not re-attempted:
      // the server already rejected that exact payload and would only reject it
      // again — it becomes eligible once more only after being fixed in the
      // form (which clears its flag). Filtering it out here also keeps its
      // rejection from being re-announced on every reconnect.
      let entries = (await this.outboxStore.listForAccount(accountKey)).filter(
        (entry) => !entry.syncError,
      );
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
          return {total: entries.length, synced: 0, flagged: 0};
        }
        const realId = await this.syncBeringer(pending);
        if (realId === null) {
          return {total: entries.length, synced: 0, flagged: 0};
        }
        await this.outbox.rewriteStaffId(pending.id, realId);
        await this.pendingBeringer.dequeue(pending.id);
      }

      // Re-read so the phase-1 `staff_id` rewrites are reflected in the payloads
      // about to be replayed; still skipping any flagged entry (issue #164).
      entries = (await this.outboxStore.listForAccount(accountKey)).filter(
        (entry) => !entry.syncError,
      );

      // Phase 2: replay the captures (oldest-first), staff_id now resolved.
      let synced = 0;
      let flagged = 0;
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
        const outcome = await this.syncEntry(entry);
        if (outcome === 'interrupted') {
          break;
        }
        if (outcome === 'synced') {
          synced++;
        } else {
          flagged++;
        }
      }
      return {total: entries.length, synced, flagged};
    } catch (error) {
      if (isSessionExpired(error)) {
        // The session expired while the device was offline — a 401 from the
        // CSRF refresh, the first request of a run, since a device offline for
        // up to ~30 days may hold a cookie the server has since let expire
        // (issue #165). Pause the whole replay — the queue is untouched — and
        // prompt a normal re-login; the same account's queue resumes on the
        // next sync after re-login (its entries are still safely queued under
        // its accountKey).
        this.promptReLogin();
        return NOTHING_TO_SYNC;
      }
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

  /**
   * Pauses sync on an expired session and prompts a normal re-login (issue
   * #165): invalidates the client session (`AuthService.sessionExpired()` —
   * so the authenticated shell hides and `guestGuard` admits `/login`, and no
   * stale identity survives an offline boot) and routes to `/login`, carrying
   * a `next` param back to where the Mitglied was so login returns them there.
   * The durable outbox is deliberately untouched — the same account's queue
   * resumes on the first sync after re-login.
   */
  private promptReLogin(): void {
    const current = this.router.url;
    const next = current && current !== '/login' ? current : '/';
    this.auth.sessionExpired();
    this.router.navigate(['/login'], {queryParams: {next}});
  }

  /**
   * The payload as it goes on the wire: the verbatim frozen payload plus the
   * schema stamp of the bundle that froze it (issue #408, ADR 0033).
   *
   * The stamp is carried *beside* the payload in IndexedDB rather than inside
   * it, so `payload` stays exactly what the form would have POSTed — and it is
   * merged in only here, on the way out, because the server is the one who needs
   * it: it migrates a drifted payload forward, which the replaying bundle could
   * never do for itself (it predates the change it would have to apply).
   *
   * An entry queued before stamping existed carries no stamp, and none is
   * invented for it: an absent `schema_version` is how the server is told "the
   * pre-versioning contract", which is exactly true of those entries.
   */
  private outgoingPayload(entry: OutboxEntry): Record<string, unknown> {
    if (entry.schemaVersion === undefined) {
      return entry.payload;
    }
    return {...entry.payload, schema_version: entry.schemaVersion};
  }

  private async syncEntry(entry: OutboxEntry): Promise<EntryOutcome> {
    try {
      await firstValueFrom(this.api.createDataEntry(this.outgoingPayload(entry)));
      await this.outbox.dequeue(entry.id);
      return 'synced';
    } catch (error) {
      if (this.isValidationRejection(error)) {
        // The payload was refused on its own merits: skip-and-flag (issue #164)
        // — leave the entry queued, tagged with the server's own message, and
        // let the caller carry on with the rest of the queue.
        await this.outbox.flag(entry, this.extractServerMessage(error));
        return 'flagged';
      }
      // Anything else is about the run, not this entry (issue #409, ADR 0033):
      // the entry stays queued, untouched and unflagged, under its original
      // idempotency key, and the whole replay stops so the remainder is retried
      // on the next attempt.
      this.startRunRemedy(error);
      return 'interrupted';
    }
  }

  /**
   * The **only** refusal that earns a Synchronisierungsfehler (ADR 0033): a
   * `400`/`422`, the server judging this payload on its own merits (validation,
   * a ring-uniqueness collision, an archived Station…), so retrying it unchanged
   * is pointless.
   *
   * Deliberately a positive list, not `4xx`. Flagging is the one outcome that
   * costs a Beringer manual work per entry — re-opening and re-saving each
   * flagged capture by hand — so it has to be *earned* by evidence that this
   * payload is the problem, rather than be what happens to a status we did not
   * recognise. The honest price, accepted in ADR 0033: a genuinely bad payload
   * answering some other 4xx retries forever instead of flagging once. Today
   * that case is empty (409 is unreachable on this path; 404 means drift), and
   * a retry cap would just be the catch-all again, wearing a hat.
   */
  private isValidationRejection(error: unknown): error is HttpErrorResponse {
    return error instanceof HttpErrorResponse && (error.status === 400 || error.status === 422);
  }

  /**
   * Aborting already leaves the queue intact and lets the next sync carry on, so
   * this only starts the remedy a given run-level condition has — where one can
   * be started from here at all.
   *
   * A `403` (typically a CSRF refusal mid-run) needs nothing: every run already
   * refreshes CSRF before its first POST, so the next sync *is* the remedy.
   */
  private startRunRemedy(error: unknown): void {
    if (error instanceof HttpErrorResponse) {
      switch (error.status) {
        case 401:
          // The session expired *mid-replay*, not on the CSRF refresh — so this
          // never reaches the run-level `isSessionExpired` handler, because
          // `syncEntry` catches its own errors (issue #409). Same remedy, and
          // the queue is just as untouched.
          this.promptReLogin();
          return;
        case 404:
          // This bundle is POSTing to an endpoint the server no longer has:
          // DRF's create never calls `get_object` and a bad FK surfaces as 400,
          // so a 404 cannot be about this entry — it is drift, and *every*
          // queued entry would answer the same. Flagging would condemn a whole
          // trip for a deploy; instead tell Offline-Bereitschaft the Version is
          // stale (ADR 0032/0033) — better evidence than ngsw's own check,
          // which a tab open since Tuesday may not have run for days.
          this.appUpdate.markVersionStale();
          return;
        case 429:
          this.holdOffUntilRetryAfter(error.headers.get('Retry-After'));
          return;
      }
    }
    console.error('Failed to sync a queued capture; it remains queued', error);
  }

  /**
   * Honours a `429`'s `Retry-After` by refusing to start another run until it
   * has elapsed — otherwise the very next `window 'online'` event
   * (`outbox-indicator.ts`) would replay straight back into the server that just
   * asked us to back off, which is not honouring it at all.
   *
   * Only the delta-seconds form is read. The HTTP-date form is ignored rather
   * than parsed: it simply means the next trigger retries sooner, which is
   * harmless. There is deliberately no backoff schedule and no throttling here —
   * a 429 cannot even occur today (no DRF throttle classes; ADR 0007 removed
   * Cloudflare, so only nginx could emit one), and the abort itself comes free
   * with the positive list.
   */
  private holdOffUntilRetryAfter(retryAfter: string | null): void {
    console.warn('Sync paused: the server asked us to retry later', retryAfter);
    const seconds = Number(retryAfter);
    if (retryAfter === null || !Number.isFinite(seconds) || seconds < 0) {
      return;
    }
    this.retryNotBefore = Date.now() + seconds * 1000;
  }

  /**
   * The human message to flag a rejected entry with, dug out of the DRF error
   * body: a plain string, a `{detail: "…"}`, or field errors
   * (`{ring_number: ["…"], …}`) joined into one line. Falls back to the
   * transport-level message, and finally a generic German sentence, so a
   * flagged entry never carries an empty explanation.
   */
  private extractServerMessage(error: HttpErrorResponse): string {
    const body: unknown = error.error;
    if (typeof body === 'string' && body.trim()) {
      return body.trim();
    }
    if (body && typeof body === 'object') {
      const detail = (body as Record<string, unknown>)['detail'];
      if (typeof detail === 'string' && detail.trim()) {
        return detail.trim();
      }
      const messages: string[] = [];
      for (const value of Object.values(body as Record<string, unknown>)) {
        if (Array.isArray(value)) {
          messages.push(...value.filter((item): item is string => typeof item === 'string'));
        } else if (typeof value === 'string' && value.trim()) {
          messages.push(value.trim());
        }
      }
      if (messages.length > 0) {
        return messages.join(' ');
      }
    }
    return error.message || 'Der Server hat den Eintrag abgelehnt.';
  }
}

/**
 * A 401 means the *server* rejected the session (expired), as opposed to a
 * connectivity failure (`status === 0`) — the `/api/auth/me/` CSRF refresh
 * returns 401 when not authenticated. Used to route an expired session to the
 * re-login prompt rather than the silent "sync could not start" pause.
 */
function isSessionExpired(error: unknown): boolean {
  return error instanceof HttpErrorResponse && error.status === 401;
}
