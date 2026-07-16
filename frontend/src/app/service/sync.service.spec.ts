import {TestBed} from '@angular/core/testing';
import {provideHttpClient} from '@angular/common/http';
import {HttpTestingController, provideHttpClientTesting} from '@angular/common/http/testing';
import {Router, provideRouter} from '@angular/router';
import {firstValueFrom} from 'rxjs';

import {SyncService} from './sync.service';
import {AppUpdateService} from './app-update.service';
import {AuthService} from './auth.service';
import {OutboxService} from './outbox.service';
import {OutboxStoreService} from '../core/offline/outbox-store';
import {PendingBeringerStoreService} from '../core/offline/pending-beringer-store';
import {IndexedDbStore} from '../core/offline/indexed-db-store';
import {OutboxEntry, PAYLOAD_SCHEMA_VERSION} from '../models/outbox-entry.model';
import {PendingBeringer} from '../models/pending-beringer.model';
import {AuthUser} from '../models/auth-user.model';

/**
 * Unit tests for the sync replay orchestrator (issue #161, PRD #152).
 * IndexedDB is the real, "faked" (per PRD's Testing Decisions) browser
 * implementation, exactly as every other offline unit spec in this repo
 * (`outbox-store.spec.ts`, `data-access-facade.service.spec.ts`,
 * `offline-readiness.spec.ts`) already exercises it — never a hand-rolled
 * mock. Because that write/read really goes through the browser's async
 * IndexedDB machinery, `settle()` (real elapsed time, not a microtask
 * `await`) is needed between a step that touches it and the next assertion
 * — the same pattern `offline-readiness.spec.ts` documents and uses.
 */

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

function makeEntry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    id: 'uuid-1',
    accountKey: 'fre',
    payload: {idempotency_key: 'uuid-1', species_id: 's1', ring_number: '0043'},
    queuedAt: '2026-07-02T09:00:00.000Z',
    ...overrides,
  };
}

function authUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    username: 'fre',
    handle: 'FRE',
    isStaff: false,
    rolle: 'mitglied',
    organization: null,
    ...overrides,
  };
}

function meResponse() {
  return {
    username: 'fre',
    handle: 'FRE',
    is_staff: false,
    active_organization_rolle: 'mitglied',
    active_organization: null,
  };
}

describe('SyncService', () => {
  let service: SyncService;
  let httpMock: HttpTestingController;
  let outboxStore: OutboxStoreService;
  let auth: AuthService;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    service = TestBed.inject(SyncService);
    httpMock = TestBed.inject(HttpTestingController);
    outboxStore = TestBed.inject(OutboxStoreService);
    auth = TestBed.inject(AuthService);
    router = TestBed.inject(Router);
  });

  afterEach(async () => {
    httpMock.verify();
    const db = TestBed.inject(IndexedDbStore);
    await db.delete('outbox', 'uuid-1');
    await db.delete('outbox', 'uuid-2');
    await db.delete('outbox', 'uuid-3');
    const beringer = await db.getAll<{id: string}>('pendingBeringer');
    await Promise.all(beringer.map((entry) => db.delete('pendingBeringer', entry.id)));
  });

  function expectCsrfFetch() {
    return httpMock.expectOne((r) => r.method === 'GET' && r.url.endsWith('/auth/me/'));
  }

  function expectCreatePost() {
    return httpMock.expectOne((r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'));
  }

  it('does nothing (no HTTP calls) when no account is authenticated', async () => {
    await outboxStore.add(makeEntry());

    const result = await firstValueFrom(service.syncNow());

    expect(result).toEqual({total: 0, synced: 0, flagged: 0});
  });

  it('does nothing when the outbox is empty for the currently authenticated account', async () => {
    auth.currentUser.set(authUser());

    const result = await firstValueFrom(service.syncNow());

    expect(result).toEqual({total: 0, synced: 0, flagged: 0});
  });

  it('fetches a fresh CSRF token before the first replay POST', async () => {
    auth.currentUser.set(authUser());
    await outboxStore.add(makeEntry());

    const resultPromise = firstValueFrom(service.syncNow());
    await settle();

    const csrfReq = expectCsrfFetch();
    csrfReq.flush(meResponse());
    await settle();

    const postReq = expectCreatePost();
    expect(postReq.request.body).toEqual(makeEntry().payload);
    postReq.flush({id: 'server-1'});
    await settle();

    const result = await resultPromise;
    expect(result).toEqual({total: 1, synced: 1, flagged: 0});
  });

  it('replays queued entries in captured order (oldest first)', async () => {
    auth.currentUser.set(authUser());
    // Seeded out of capture order — the replay must still follow queuedAt.
    await outboxStore.add(
      makeEntry({
        id: 'uuid-2',
        queuedAt: '2026-07-02T09:05:00.000Z',
        payload: {idempotency_key: 'uuid-2', ring_number: 'second'},
      }),
    );
    await outboxStore.add(
      makeEntry({
        id: 'uuid-1',
        queuedAt: '2026-07-02T09:00:00.000Z',
        payload: {idempotency_key: 'uuid-1', ring_number: 'first'},
      }),
    );

    const resultPromise = firstValueFrom(service.syncNow());
    await settle();
    expectCsrfFetch().flush(meResponse());
    await settle();

    const firstReq = expectCreatePost();
    expect(firstReq.request.body).toEqual({idempotency_key: 'uuid-1', ring_number: 'first'});
    firstReq.flush({id: 's1'});
    await settle();

    const secondReq = expectCreatePost();
    expect(secondReq.request.body).toEqual({idempotency_key: 'uuid-2', ring_number: 'second'});
    secondReq.flush({id: 's2'});
    await settle();

    const result = await resultPromise;
    expect(result).toEqual({total: 2, synced: 2, flagged: 0});
  });

  it('removes each successfully synced entry from the outbox and updates the pending count', async () => {
    auth.currentUser.set(authUser());
    const outbox = TestBed.inject(OutboxService);
    await outbox.ready;
    // enqueue() (not the raw store) so the reactive pendingCount signal is
    // seeded too, exactly as it would be by a real offline capture.
    await firstValueFrom(outbox.enqueue(makeEntry().payload));
    expect(outbox.pendingCount()).toBe(1);

    const resultPromise = firstValueFrom(service.syncNow());
    await settle();
    expectCsrfFetch().flush(meResponse());
    await settle();
    expectCreatePost().flush({id: 'server-1'});
    await settle();

    await resultPromise;
    expect(await outboxStore.list()).toEqual([]);
    expect(outbox.pendingCount()).toBe(0);
  });

  it('never replays another account\'s queued entries (account-keyed isolation)', async () => {
    auth.currentUser.set(authUser({username: 'fre'}));
    await outboxStore.add(makeEntry({id: 'uuid-1', accountKey: 'fre'}));
    await outboxStore.add(makeEntry({id: 'uuid-2', accountKey: 'anm'}));

    const resultPromise = firstValueFrom(service.syncNow());
    await settle();
    expectCsrfFetch().flush(meResponse());
    await settle();

    const req = expectCreatePost();
    expect(req.request.body).toEqual(makeEntry({id: 'uuid-1', accountKey: 'fre'}).payload);
    req.flush({id: 'server-1'});
    await settle();

    const result = await resultPromise;
    expect(result).toEqual({total: 1, synced: 1, flagged: 0});

    const remaining = await outboxStore.list();
    expect(remaining.map((e) => e.id)).toEqual(['uuid-2']);
  });

  it('stops replaying at the first failure, leaving the remainder queued (interrupted sync → partial completion)', async () => {
    auth.currentUser.set(authUser());
    await outboxStore.add(
      makeEntry({id: 'uuid-1', queuedAt: '2026-07-02T09:00:00.000Z', payload: {idempotency_key: 'uuid-1'}}),
    );
    await outboxStore.add(
      makeEntry({id: 'uuid-2', queuedAt: '2026-07-02T09:05:00.000Z', payload: {idempotency_key: 'uuid-2'}}),
    );

    const resultPromise = firstValueFrom(service.syncNow());
    await settle();
    expectCsrfFetch().flush(meResponse());
    await settle();

    expectCreatePost().flush({id: 'server-1'}); // uuid-1 succeeds
    await settle();

    expectCreatePost().error(new ProgressEvent('error')); // uuid-2: connectivity drops mid-sync
    await settle();

    const result = await resultPromise;
    expect(result).toEqual({total: 2, synced: 1, flagged: 0});

    const remaining = await outboxStore.list();
    expect(remaining.map((e) => e.id)).toEqual(['uuid-2']);
  });

  it('retries an interrupted sync from where it left off, replaying the still-queued entry under its original idempotency key (no duplicate)', async () => {
    auth.currentUser.set(authUser());
    await outboxStore.add(
      makeEntry({id: 'uuid-1', queuedAt: '2026-07-02T09:00:00.000Z', payload: {idempotency_key: 'uuid-1'}}),
    );
    await outboxStore.add(
      makeEntry({id: 'uuid-2', queuedAt: '2026-07-02T09:05:00.000Z', payload: {idempotency_key: 'uuid-2'}}),
    );

    // First attempt: uuid-1 syncs, uuid-2 is interrupted.
    const firstRun = firstValueFrom(service.syncNow());
    await settle();
    expectCsrfFetch().flush(meResponse());
    await settle();
    expectCreatePost().flush({id: 'server-1'});
    await settle();
    expectCreatePost().error(new ProgressEvent('error'));
    await settle();
    expect(await firstRun).toEqual({total: 2, synced: 1, flagged: 0});

    // Retry: replays only the still-queued uuid-2, under its original key —
    // never a freshly-minted one, and uuid-1 is never POSTed again.
    const secondRun = firstValueFrom(service.syncNow());
    await settle();
    expectCsrfFetch().flush(meResponse());
    await settle();

    const retryReq = expectCreatePost();
    expect(retryReq.request.body).toEqual({idempotency_key: 'uuid-2'});
    retryReq.flush({id: 'server-2'});
    await settle();

    expect(await secondRun).toEqual({total: 1, synced: 1, flagged: 0});
    expect(await outboxStore.list()).toEqual([]);
  });

  it('aborts without attempting any entry when the CSRF-token fetch itself fails (e.g. no connectivity)', async () => {
    auth.currentUser.set(authUser());
    await outboxStore.add(makeEntry());

    const resultPromise = firstValueFrom(service.syncNow());
    await settle();

    expectCsrfFetch().error(new ProgressEvent('error'));
    await settle();

    const result = await resultPromise;
    expect(result).toEqual({total: 0, synced: 0, flagged: 0});
    expect(await outboxStore.list()).toEqual([makeEntry()]);
  });

  it('aborts the replay when the active account changes mid-flight, leaving the remainder queued (account-switch safety)', async () => {
    auth.currentUser.set(authUser({username: 'fre'}));
    await outboxStore.add(
      makeEntry({id: 'uuid-1', accountKey: 'fre', queuedAt: '2026-07-02T09:00:00.000Z', payload: {idempotency_key: 'uuid-1'}}),
    );
    await outboxStore.add(
      makeEntry({id: 'uuid-2', accountKey: 'fre', queuedAt: '2026-07-02T09:05:00.000Z', payload: {idempotency_key: 'uuid-2'}}),
    );

    const resultPromise = firstValueFrom(service.syncNow());
    await settle();
    expectCsrfFetch().flush(meResponse());
    await settle();

    expectCreatePost().flush({id: 'server-1'}); // uuid-1 syncs while still 'fre'

    // A different Mitglied logs in on the same shared/offline device (or
    // another tab sharing the session cookie) — before the loop reaches its
    // pre-entry check for uuid-2, so it must abort there instead of
    // replaying uuid-2 too.
    auth.currentUser.set(authUser({username: 'anm'}));
    await settle();

    const result = await resultPromise;
    expect(result).toEqual({total: 2, synced: 1, flagged: 0});

    // uuid-2 was never POSTed under 'anm''s session/org, and stays queued
    // under its original account for 'fre''s next sync.
    const remaining = await outboxStore.list();
    expect(remaining.map((e) => e.id)).toEqual(['uuid-2']);
    // The singleton flag must not be left stuck true across the switch —
    // otherwise 'anm''s own "sync on app start" auto-trigger would be a
    // silent no-op.
    expect(service.syncing()).toBeFalse();
  });

  describe('skip-and-flag on rejection (issue #164)', () => {
    it('skips a server-rejected entry — flagging it with the server error — while the rest of the queue syncs on', async () => {
      auth.currentUser.set(authUser());
      await outboxStore.add(
        makeEntry({id: 'uuid-1', queuedAt: '2026-07-02T09:00:00.000Z', payload: {idempotency_key: 'uuid-1'}}),
      );
      await outboxStore.add(
        makeEntry({id: 'uuid-2', queuedAt: '2026-07-02T09:05:00.000Z', payload: {idempotency_key: 'uuid-2'}}),
      );
      await outboxStore.add(
        makeEntry({id: 'uuid-3', queuedAt: '2026-07-02T09:10:00.000Z', payload: {idempotency_key: 'uuid-3'}}),
      );

      const resultPromise = firstValueFrom(service.syncNow());
      await settle();
      expectCsrfFetch().flush(meResponse());
      await settle();

      expectCreatePost().flush({id: 'server-1'}); // uuid-1 syncs
      await settle();

      // uuid-2 is rejected — a genuine ring-uniqueness collision from a
      // concurrent device (ADR 0006): a 400 with a DRF field-error body.
      expectCreatePost().flush(
        {ring_number: ['Für diese Ringnummer besteht in dieser Organisation bereits ein Erstfang.']},
        {status: 400, statusText: 'Bad Request'},
      );
      await settle();

      expectCreatePost().flush({id: 'server-3'}); // uuid-3 still syncs
      await settle();

      const result = await resultPromise;
      expect(result).toEqual({total: 3, synced: 2, flagged: 1});

      // The two good entries left the queue; the rejected one stays, flagged
      // with the server's own message (not silently lost).
      const remaining = await outboxStore.list();
      expect(remaining.map((e) => e.id)).toEqual(['uuid-2']);
      expect(remaining[0].syncError).toBe(
        'Für diese Ringnummer besteht in dieser Organisation bereits ein Erstfang.',
      );
    });

    it('flags with the server\'s {detail} message when the body is not a field-error map', async () => {
      auth.currentUser.set(authUser());
      await outboxStore.add(makeEntry({id: 'uuid-1', payload: {idempotency_key: 'uuid-1'}}));

      const resultPromise = firstValueFrom(service.syncNow());
      await settle();
      expectCsrfFetch().flush(meResponse());
      await settle();

      expectCreatePost().flush(
        {detail: 'Diese Station wurde archiviert.'},
        {status: 400, statusText: 'Bad Request'},
      );
      await settle();

      expect(await resultPromise).toEqual({total: 1, synced: 0, flagged: 1});
      const remaining = await outboxStore.list();
      expect(remaining[0].syncError).toBe('Diese Station wurde archiviert.');
    });

    it('does not re-attempt an already-flagged entry — only the still-eligible one is replayed', async () => {
      auth.currentUser.set(authUser());
      // uuid-1 was flagged on a previous sync; uuid-2 is a fresh, clean capture.
      await outboxStore.add(
        makeEntry({
          id: 'uuid-1',
          queuedAt: '2026-07-02T09:00:00.000Z',
          payload: {idempotency_key: 'uuid-1'},
          syncError: 'Für diese Ringnummer besteht in dieser Organisation bereits ein Erstfang.',
        }),
      );
      await outboxStore.add(
        makeEntry({id: 'uuid-2', queuedAt: '2026-07-02T09:05:00.000Z', payload: {idempotency_key: 'uuid-2'}}),
      );

      const resultPromise = firstValueFrom(service.syncNow());
      await settle();
      expectCsrfFetch().flush(meResponse());
      await settle();

      // Only uuid-2 is POSTed — the flagged uuid-1 is never re-sent.
      const req = expectCreatePost();
      expect(req.request.body).toEqual({idempotency_key: 'uuid-2'});
      req.flush({id: 'server-2'});
      await settle();

      expect(await resultPromise).toEqual({total: 1, synced: 1, flagged: 0});
      // uuid-1 stays queued, still flagged; uuid-2 drained.
      const remaining = await outboxStore.list();
      expect(remaining.map((e) => e.id)).toEqual(['uuid-1']);
    });

    it('stops (does not skip-and-flag) on a transient failure — a 5xx keeps the entry queued unflagged', async () => {
      auth.currentUser.set(authUser());
      await outboxStore.add(makeEntry({id: 'uuid-1', payload: {idempotency_key: 'uuid-1'}}));

      const resultPromise = firstValueFrom(service.syncNow());
      await settle();
      expectCsrfFetch().flush(meResponse());
      await settle();

      expectCreatePost().flush({detail: 'boom'}, {status: 503, statusText: 'Service Unavailable'});
      await settle();

      expect(await resultPromise).toEqual({total: 1, synced: 0, flagged: 0});
      const remaining = await outboxStore.list();
      expect(remaining.map((e) => e.id)).toEqual(['uuid-1']);
      expect(remaining[0].syncError).toBeFalsy();
    });
  });

  describe('flagging is earned, not assumed (issue #409, ADR 0033)', () => {
    // Only a refusal of the payload on its own merits (400/422) earns a
    // Synchronisierungsfehler — the one outcome that costs a Beringer manual
    // work per entry. Every other 4xx is a condition of the *run*: it aborts,
    // touching nothing, and the next sync simply carries on.

    it('flags a 422 — the positive list\'s other refusal of the payload on its own merits', async () => {
      // 400's twin, and the only member of the list no backend emits today
      // (DRF answers a ValidationError with 400), which is precisely why it
      // needs its own assertion: dropping it would change nothing any other
      // spec, or any server we run, could notice.
      auth.currentUser.set(authUser());
      await outboxStore.add(
        makeEntry({id: 'uuid-1', queuedAt: '2026-07-02T09:00:00.000Z', payload: {idempotency_key: 'uuid-1'}}),
      );
      await outboxStore.add(
        makeEntry({id: 'uuid-2', queuedAt: '2026-07-02T09:05:00.000Z', payload: {idempotency_key: 'uuid-2'}}),
      );

      const resultPromise = firstValueFrom(service.syncNow());
      await settle();
      expectCsrfFetch().flush(meResponse());
      await settle();

      expectCreatePost().flush(
        {detail: 'Der Eintrag konnte nicht verarbeitet werden.'},
        {status: 422, statusText: 'Unprocessable Entity'},
      );
      await settle();

      // Skip-and-flag, exactly like a 400: uuid-2 still syncs behind it.
      expectCreatePost().flush({id: 'server-2'});
      await settle();

      expect(await resultPromise).toEqual({total: 2, synced: 1, flagged: 1});
      const remaining = await outboxStore.list();
      expect(remaining.map((e) => e.id)).toEqual(['uuid-1']);
      expect(remaining[0].syncError).toBe('Der Eintrag konnte nicht verarbeitet werden.');
    });

    it('aborts on a 4xx nobody enumerated (418) — the list is positive, so the default does not flag', async () => {
      // The fence around the *default*, which is the whole reason ADR 0033 chose
      // a positive list over enumerating statuses. Every other spec in this block
      // names a status someone thought about; an enumeration wearing an
      // allowlist's clothes (`4xx && ![401,403,404,429].includes(status)`) would
      // satisfy all of them and still flag real field data here. So this one
      // deliberately uses a status the app has no opinion on whatsoever: what it
      // pins is that recognising nothing earns nothing — not flagging, and no
      // remedy either.
      auth.currentUser.set(authUser());
      await outboxStore.add(
        makeEntry({id: 'uuid-1', queuedAt: '2026-07-02T09:00:00.000Z', payload: {idempotency_key: 'uuid-1'}}),
      );
      await outboxStore.add(
        makeEntry({id: 'uuid-2', queuedAt: '2026-07-02T09:05:00.000Z', payload: {idempotency_key: 'uuid-2'}}),
      );
      const appUpdate = TestBed.inject(AppUpdateService);
      const navigate = spyOn(router, 'navigate').and.stub();

      const resultPromise = firstValueFrom(service.syncNow());
      await settle();
      expectCsrfFetch().flush(meResponse());
      await settle();

      // uuid-2 is never POSTed — httpMock.verify() in afterEach fails on a stray
      // create — so the run really stopped rather than carrying on past it.
      expectCreatePost().flush({detail: "I'm a teapot"}, {status: 418, statusText: "I'm a teapot"});
      await settle();

      expect(await resultPromise).toEqual({total: 2, synced: 0, flagged: 0});

      // The whole queue is intact and unflagged: nothing for the Beringer to
      // re-open and re-save by hand over a status we simply did not recognise.
      const remaining = await outboxStore.list();
      expect(remaining.map((e) => e.id)).toEqual(['uuid-1', 'uuid-2']);
      expect(remaining.every((e) => !e.syncError)).toBeTrue();

      // And no remedy was invented on no evidence: this is not drift (that is
      // 404's meaning, not any 4xx's) and the session is not expired.
      expect(appUpdate.versionStale()).toBeFalse();
      expect(navigate).not.toHaveBeenCalled();
    });

    it('aborts the run on a CSRF refusal mid-replay (403) instead of flagging real field data', async () => {
      auth.currentUser.set(authUser());
      await outboxStore.add(
        makeEntry({id: 'uuid-1', queuedAt: '2026-07-02T09:00:00.000Z', payload: {idempotency_key: 'uuid-1'}}),
      );
      await outboxStore.add(
        makeEntry({id: 'uuid-2', queuedAt: '2026-07-02T09:05:00.000Z', payload: {idempotency_key: 'uuid-2'}}),
      );
      await outboxStore.add(
        makeEntry({id: 'uuid-3', queuedAt: '2026-07-02T09:10:00.000Z', payload: {idempotency_key: 'uuid-3'}}),
      );

      const resultPromise = firstValueFrom(service.syncNow());
      await settle();
      expectCsrfFetch().flush(meResponse());
      await settle();

      expectCreatePost().flush({id: 'server-1'}); // uuid-1 syncs
      await settle();

      // uuid-2 hits a CSRF refusal — transient, and about the run, not about
      // this capture. uuid-3 is never POSTed (httpMock.verify() in afterEach
      // fails on a stray create).
      expectCreatePost().flush(
        {detail: 'CSRF Failed: CSRF token missing or incorrect.'},
        {status: 403, statusText: 'Forbidden'},
      );
      await settle();

      expect(await resultPromise).toEqual({total: 3, synced: 1, flagged: 0});

      // Both untried entries stay queued and unflagged: nothing to re-save by
      // hand, and the next sync (which refreshes CSRF first) replays them.
      const remaining = await outboxStore.list();
      expect(remaining.map((e) => e.id)).toEqual(['uuid-2', 'uuid-3']);
      expect(remaining.every((e) => !e.syncError)).toBeTrue();
    });

    it('pauses and prompts a re-login when the session expires mid-replay (a per-entry 401)', async () => {
      // The session can expire *between* entries, not just on the CSRF refresh
      // that opens a run — a long replay outlives a short session. Such a 401
      // never reaches the run-level handler, because syncEntry catches its own
      // errors, so it used to be treated exactly like a validation refusal.
      auth.currentUser.set(authUser());
      await outboxStore.add(
        makeEntry({id: 'uuid-1', queuedAt: '2026-07-02T09:00:00.000Z', payload: {idempotency_key: 'uuid-1'}}),
      );
      await outboxStore.add(
        makeEntry({id: 'uuid-2', queuedAt: '2026-07-02T09:05:00.000Z', payload: {idempotency_key: 'uuid-2'}}),
      );
      const navigate = spyOn(router, 'navigate').and.stub();

      const resultPromise = firstValueFrom(service.syncNow());
      await settle();
      expectCsrfFetch().flush(meResponse());
      await settle();

      expectCreatePost().flush({id: 'server-1'}); // uuid-1 syncs
      await settle();

      expectCreatePost().flush(
        {detail: 'Authentication credentials were not provided.'},
        {status: 401, statusText: 'Unauthorized'},
      );
      await settle();

      // The run reports what really happened — one synced, nothing flagged —
      // rather than pretending the whole run was a no-op.
      expect(await resultPromise).toEqual({total: 2, synced: 1, flagged: 0});

      // uuid-2 stays queued, unflagged: it is a perfectly good capture that
      // merely arrived after the session died.
      const remaining = await outboxStore.list();
      expect(remaining.map((e) => e.id)).toEqual(['uuid-2']);
      expect(remaining[0].syncError).toBeFalsy();

      // Same remedy as an expired session on the CSRF refresh: a normal
      // re-login, after which the intact queue resumes.
      expect(navigate.calls.mostRecent().args[0]).toEqual(['/login']);
      expect(auth.currentUser()).toBeNull();
      expect(service.syncing()).toBeFalse();
    });

    it('reports the Version stale and aborts on a 404 — drift is never one entry\'s fault', async () => {
      // A 404 on the create path means this bundle is POSTing to an endpoint the
      // server no longer has: systemic, so every queued entry would answer the
      // same. Flagging would condemn a whole trip's captures for a deploy.
      auth.currentUser.set(authUser());
      await outboxStore.add(
        makeEntry({id: 'uuid-1', queuedAt: '2026-07-02T09:00:00.000Z', payload: {idempotency_key: 'uuid-1'}}),
      );
      await outboxStore.add(
        makeEntry({id: 'uuid-2', queuedAt: '2026-07-02T09:05:00.000Z', payload: {idempotency_key: 'uuid-2'}}),
      );
      const appUpdate = TestBed.inject(AppUpdateService);
      expect(appUpdate.versionStale()).toBeFalse();

      const resultPromise = firstValueFrom(service.syncNow());
      await settle();
      expectCsrfFetch().flush(meResponse());
      await settle();

      expectCreatePost().flush({detail: 'Not found.'}, {status: 404, statusText: 'Not Found'});
      await settle();

      expect(await resultPromise).toEqual({total: 2, synced: 0, flagged: 0});

      // The whole queue is intact and unflagged — nothing to re-save by hand.
      const remaining = await outboxStore.list();
      expect(remaining.map((e) => e.id)).toEqual(['uuid-1', 'uuid-2']);
      expect(remaining.every((e) => !e.syncError)).toBeTrue();

      // And the device now knows it is not offline bereit: the server just
      // proved this Version is stale, which is what "Jetzt aktualisieren" is
      // for (the indicator renders this in offline-readiness.spec.ts).
      expect(appUpdate.versionStale()).toBeTrue();
    });

    it('reports the Version stale when the CSRF refresh 404s — the run\'s first request is on the replay path too', async () => {
      // `GET /api/auth/me/` opens every run that has anything to replay, ahead of
      // both POST phases, so it is the request that meets a drifted server first.
      // It takes no id and returns the current session's own user, so it cannot
      // 404 for any reason but the one 404 means here: this bundle is calling an
      // endpoint the server no longer has. ADR 0033 decision 5 carves out no
      // exception for which request runs into the drift, and aborting quietly
      // would leave a green "Offline bereit" over a sync that cannot succeed.
      auth.currentUser.set(authUser());
      await outboxStore.add(makeEntry({id: 'uuid-1', payload: {idempotency_key: 'uuid-1'}}));
      const appUpdate = TestBed.inject(AppUpdateService);
      expect(appUpdate.versionStale()).toBeFalse();

      const resultPromise = firstValueFrom(service.syncNow());
      await settle();
      expectCsrfFetch().flush({detail: 'Not found.'}, {status: 404, statusText: 'Not Found'});
      await settle();

      // Nothing was attempted (httpMock.verify() in afterEach would fail on a
      // create), so the run reports "nothing to do" and the queue is untouched.
      expect(await resultPromise).toEqual({total: 0, synced: 0, flagged: 0});
      const remaining = await outboxStore.list();
      expect(remaining.map((e) => e.id)).toEqual(['uuid-1']);
      expect(remaining[0].syncError).toBeFalsy();

      // The device now knows it is not offline bereit, rather than showing a
      // reassurance the server has just disproved.
      expect(appUpdate.versionStale()).toBeTrue();
    });

    it('starts no remedy when the run cannot even read its queue (a failure that is not HTTP at all)', async () => {
      // The run opens with a local, account-scoped read, so the same handler that
      // sees the CSRF refresh's status also sees errors that carry no status at
      // all. None of them is evidence of drift or of an expired session, and the
      // abort is the whole response: everything stays queued for the next sync.
      auth.currentUser.set(authUser());
      await outboxStore.add(makeEntry({id: 'uuid-1', payload: {idempotency_key: 'uuid-1'}}));
      spyOn(outboxStore, 'listForAccount').and.rejectWith(new Error('IndexedDB is unavailable'));
      const appUpdate = TestBed.inject(AppUpdateService);
      const navigate = spyOn(router, 'navigate').and.stub();

      const result = await firstValueFrom(service.syncNow());
      await settle();

      expect(result).toEqual({total: 0, synced: 0, flagged: 0});
      expect(appUpdate.versionStale()).toBeFalse();
      expect(navigate).not.toHaveBeenCalled();
      expect(service.syncing()).toBeFalse();
      expect((await outboxStore.list()).map((e) => e.id)).toEqual(['uuid-1']);
    });

    it('aborts on a rate limit (429) and holds the next run off until Retry-After has elapsed', async () => {
      // A big queue replaying at once is exactly what would trip a rate limit,
      // so flagging here would punish the fullest outbox hardest. Aborting is
      // not enough on its own: the next 'online' event fires a sync immediately,
      // straight back into the server that just asked us to wait.
      auth.currentUser.set(authUser());
      await outboxStore.add(makeEntry({id: 'uuid-1', payload: {idempotency_key: 'uuid-1'}}));

      const resultPromise = firstValueFrom(service.syncNow());
      await settle();
      expectCsrfFetch().flush(meResponse());
      await settle();

      expectCreatePost().flush(
        {detail: 'Request was throttled.'},
        {status: 429, statusText: 'Too Many Requests', headers: {'Retry-After': '60'}},
      );
      await settle();

      expect(await resultPromise).toEqual({total: 1, synced: 0, flagged: 0});
      const remaining = await outboxStore.list();
      expect(remaining.map((e) => e.id)).toEqual(['uuid-1']);
      expect(remaining[0].syncError).toBeFalsy();

      // A sync triggered inside the window makes no request at all — httpMock's
      // verify() in afterEach would fail on any.
      expect(await firstValueFrom(service.syncNow())).toEqual({total: 0, synced: 0, flagged: 0});
      await settle();
    });

    it('does not hold the next run off when a 429 carries no Retry-After', async () => {
      // "Honour it if present" — with nothing to honour, waiting an invented
      // amount of time would strand the queue on a guess.
      auth.currentUser.set(authUser());
      await outboxStore.add(makeEntry({id: 'uuid-1', payload: {idempotency_key: 'uuid-1'}}));

      const firstRun = firstValueFrom(service.syncNow());
      await settle();
      expectCsrfFetch().flush(meResponse());
      await settle();
      expectCreatePost().flush({detail: 'Request was throttled.'}, {status: 429, statusText: 'Too Many Requests'});
      await settle();
      expect(await firstRun).toEqual({total: 1, synced: 0, flagged: 0});

      // The next run proceeds normally and drains the still-intact queue.
      const secondRun = firstValueFrom(service.syncNow());
      await settle();
      expectCsrfFetch().flush(meResponse());
      await settle();
      expectCreatePost().flush({id: 'server-1'});
      await settle();

      expect(await secondRun).toEqual({total: 1, synced: 1, flagged: 0});
      expect(await outboxStore.list()).toEqual([]);
    });
  });

  describe('payload schema stamp (issue #408, ADR 0033)', () => {
    // A payload is frozen at queue time and IndexedDB outlives any bundle swap,
    // so a device offline ~30 days replays a month-old contract. The stamp is
    // what lets the server see that drift and migrate — it must reach the wire,
    // since a stamp that never leaves the device answers nobody's question.

    it('puts the payload schema version of the bundle that queued the capture on the wire', async () => {
      auth.currentUser.set(authUser());
      const outbox = TestBed.inject(OutboxService);
      await outbox.ready;
      await firstValueFrom(outbox.enqueue({idempotency_key: 'uuid-1', ring_number: '0043'}));

      const resultPromise = firstValueFrom(service.syncNow());
      await settle();
      expectCsrfFetch().flush(meResponse());
      await settle();

      const postReq = expectCreatePost();
      expect(postReq.request.body).toEqual({
        idempotency_key: 'uuid-1',
        ring_number: '0043',
        schema_version: PAYLOAD_SCHEMA_VERSION,
      });
      postReq.flush({id: 'server-1'});
      await settle();

      expect(await resultPromise).toEqual({total: 1, synced: 1, flagged: 0});
    });

    it('sends no stamp for an entry queued before stamping existed (the pre-versioning contract)', async () => {
      // Stamping is itself a contract change, so it has to tolerate its own
      // absence from day one: on the morning this ships, every entry already
      // sitting in a real device's outbox carries no stamp. Inventing one here
      // would be a lie — the bundle that froze this payload never made a claim
      // about its contract, and the server reads an absent stamp as exactly that.
      auth.currentUser.set(authUser());
      await outboxStore.add(makeEntry({payload: {idempotency_key: 'uuid-1', ring_number: '0043'}}));

      const resultPromise = firstValueFrom(service.syncNow());
      await settle();
      expectCsrfFetch().flush(meResponse());
      await settle();

      const postReq = expectCreatePost();
      expect(postReq.request.body).toEqual({idempotency_key: 'uuid-1', ring_number: '0043'});
      expect(postReq.request.body.schema_version).toBeUndefined();
      postReq.flush({id: 'server-1'});
      await settle();

      expect(await resultPromise).toEqual({total: 1, synced: 1, flagged: 0});
    });
  });

  it('pauses replay and prompts a re-login when the session has expired mid-trip (401 on the CSRF refresh)', async () => {
    // A device offline for weeks holds an expired session cookie; the CSRF
    // refresh is the first request of a sync run and 401s (issue #165).
    auth.currentUser.set(authUser());
    await outboxStore.add(makeEntry());
    const navigate = spyOn(router, 'navigate').and.stub();

    const resultPromise = firstValueFrom(service.syncNow());
    await settle();
    expectCsrfFetch().flush({detail: 'Not authenticated.'}, {status: 401, statusText: 'Unauthorized'});
    await settle();

    // Replay paused: nothing was POSTed (httpMock.verify() in afterEach would
    // fail on an unmatched create) and the queue is untouched.
    const result = await resultPromise;
    expect(result).toEqual({total: 0, synced: 0, flagged: 0});
    expect((await outboxStore.list()).map((e) => e.id)).toEqual(['uuid-1']);

    // The Mitglied is prompted to re-login (guestGuard needs the client session
    // cleared to reach /login), with a next param back to where they were.
    expect(navigate).toHaveBeenCalled();
    const [commands, extras] = navigate.calls.mostRecent().args as [string[], {queryParams?: {next?: string}}];
    expect(commands).toEqual(['/login']);
    expect(extras.queryParams?.next).toBeDefined();
    expect(auth.currentUser()).toBeNull();
    // Not left stuck in-progress, so the resume sync after re-login can run.
    expect(service.syncing()).toBeFalse();
  });

  it('resumes the same account\'s intact queue on the next sync after re-login', async () => {
    auth.currentUser.set(authUser());
    await outboxStore.add(makeEntry());
    spyOn(router, 'navigate').and.stub();

    // First run: session expired, replay paused, queue intact.
    const firstRun = firstValueFrom(service.syncNow());
    await settle();
    expectCsrfFetch().flush({detail: 'Not authenticated.'}, {status: 401, statusText: 'Unauthorized'});
    await settle();
    expect(await firstRun).toEqual({total: 0, synced: 0, flagged: 0});

    // The Mitglied re-logs in as the same account (currentUser repopulated).
    auth.currentUser.set(authUser());

    // Resume: the still-queued entry now replays cleanly under its original key.
    const secondRun = firstValueFrom(service.syncNow());
    await settle();
    expectCsrfFetch().flush(meResponse());
    await settle();
    const postReq = expectCreatePost();
    expect(postReq.request.body).toEqual(makeEntry().payload);
    postReq.flush({id: 'server-1'});
    await settle();

    expect(await secondRun).toEqual({total: 1, synced: 1, flagged: 0});
    expect(await outboxStore.list()).toEqual([]);
  });

  it('reflects the in-progress state via the syncing() signal', async () => {
    auth.currentUser.set(authUser());
    await outboxStore.add(makeEntry());
    expect(service.syncing()).toBeFalse();

    const resultPromise = firstValueFrom(service.syncNow());
    await settle();
    expect(service.syncing()).toBeTrue();

    expectCsrfFetch().flush(meResponse());
    await settle();
    expectCreatePost().flush({id: 'server-1'});
    await settle();

    await resultPromise;
    expect(service.syncing()).toBeFalse();
  });

  it('ignores a concurrent second call while a sync is already running', async () => {
    auth.currentUser.set(authUser());
    await outboxStore.add(makeEntry());

    const first = firstValueFrom(service.syncNow());
    await settle();
    expect(service.syncing()).toBeTrue();

    const second = await firstValueFrom(service.syncNow());
    expect(second).toEqual({total: 0, synced: 0, flagged: 0});

    expectCsrfFetch().flush(meResponse());
    await settle();
    expectCreatePost().flush({id: 'server-1'});
    await settle();
    await first;
  });

  describe('quick-added Beringer synced before its dependent captures (issue #167)', () => {
    let pendingStore: PendingBeringerStoreService;

    beforeEach(() => {
      pendingStore = TestBed.inject(PendingBeringerStoreService);
    });

    function makePending(overrides: Partial<PendingBeringer> = {}): PendingBeringer {
      return {
        id: 'local-b',
        accountKey: 'fre',
        first_name: 'Filip',
        last_name: 'Reiter',
        handle: 'FRE',
        queuedAt: '2026-07-02T08:59:00.000Z',
        ...overrides,
      };
    }

    function expectScientistPost() {
      return httpMock.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/birds/scientists/'),
      );
    }

    it('creates the Beringer first, then replays the capture resolved to the real server id', async () => {
      auth.currentUser.set(authUser());
      await pendingStore.add(makePending());
      await outboxStore.add(
        makeEntry({
          id: 'uuid-1',
          queuedAt: '2026-07-02T09:00:00.000Z',
          payload: {idempotency_key: 'uuid-1', species_id: 's1', staff_id: 'local-b', ring_number: '0043'},
        }),
      );

      const resultPromise = firstValueFrom(service.syncNow());
      await settle();
      expectCsrfFetch().flush(meResponse());
      await settle();

      // The Beringer is created BEFORE any dependent capture is POSTed.
      const beringerReq = expectScientistPost();
      expect(beringerReq.request.body).toEqual({
        first_name: 'Filip',
        last_name: 'Reiter',
        handle: 'FRE',
      });
      beringerReq.flush({id: 'server-sci-1', handle: 'FRE', full_name: 'Filip Reiter'});
      await settle();

      // The capture then replays with its staff_id resolved to the real id.
      const captureReq = expectCreatePost();
      expect(captureReq.request.body.staff_id).toBe('server-sci-1');
      captureReq.flush({id: 'server-1'});
      await settle();

      expect(await resultPromise).toEqual({total: 1, synced: 1, flagged: 0});
      expect(await pendingStore.list()).toEqual([]);
      expect(await outboxStore.list()).toEqual([]);
    });

    it('matches a Kürzel already created server-side: the capture resolves to the returned (existing) id, never duplicating', async () => {
      auth.currentUser.set(authUser());
      await pendingStore.add(makePending());
      await outboxStore.add(
        makeEntry({
          id: 'uuid-1',
          queuedAt: '2026-07-02T09:00:00.000Z',
          payload: {idempotency_key: 'uuid-1', staff_id: 'local-b'},
        }),
      );

      const resultPromise = firstValueFrom(service.syncNow());
      await settle();
      expectCsrfFetch().flush(meResponse());
      await settle();

      // The server matched the Kürzel to a Beringer created server-side in the
      // meantime (idempotent create) and returns its real, pre-existing id.
      expectScientistPost().flush({id: 'server-existing', handle: 'FRE', full_name: 'Filip Reiter'});
      await settle();

      const captureReq = expectCreatePost();
      expect(captureReq.request.body.staff_id).toBe('server-existing');
      captureReq.flush({id: 'server-1'});
      await settle();

      expect(await resultPromise).toEqual({total: 1, synced: 1, flagged: 0});
    });

    it('stops before any dependent capture when the Beringer create fails, leaving both queued for the next attempt', async () => {
      auth.currentUser.set(authUser());
      await pendingStore.add(makePending());
      await outboxStore.add(
        makeEntry({
          id: 'uuid-1',
          queuedAt: '2026-07-02T09:00:00.000Z',
          payload: {idempotency_key: 'uuid-1', staff_id: 'local-b'},
        }),
      );

      const resultPromise = firstValueFrom(service.syncNow());
      await settle();
      expectCsrfFetch().flush(meResponse());
      await settle();

      // Connectivity drops on the Beringer create — the whole sync stops before
      // the capture is ever POSTed (it depends on the not-yet-created Beringer).
      expectScientistPost().error(new ProgressEvent('error'));
      await settle();

      expect(await resultPromise).toEqual({total: 1, synced: 0, flagged: 0});
      expect((await pendingStore.list()).map((b) => b.id)).toEqual(['local-b']);
      expect((await outboxStore.list()).map((e) => e.id)).toEqual(['uuid-1']);
    });

    it('reports the Version stale when the Beringer create 404s — phase 1 is on the replay path too (issue #409)', async () => {
      // The quick-added Beringer is POSTed FIRST, before any capture, so drift
      // surfaces here before the capture path ever gets a say. A 404 on
      // `/birds/scientists/` is the same systemic evidence as one on
      // `/birds/data-entries/`: this bundle is talking to an endpoint the server
      // no longer has. Aborting without saying so left the indicator on a green
      // "Offline bereit" — the false all-clear ADR 0033 exists to kill.
      auth.currentUser.set(authUser());
      await pendingStore.add(makePending());
      await outboxStore.add(
        makeEntry({
          id: 'uuid-1',
          queuedAt: '2026-07-02T09:00:00.000Z',
          payload: {idempotency_key: 'uuid-1', staff_id: 'local-b'},
        }),
      );
      const appUpdate = TestBed.inject(AppUpdateService);
      expect(appUpdate.versionStale()).toBeFalse();

      const resultPromise = firstValueFrom(service.syncNow());
      await settle();
      expectCsrfFetch().flush(meResponse());
      await settle();

      expectScientistPost().flush({detail: 'Not found.'}, {status: 404, statusText: 'Not Found'});
      await settle();

      expect(await resultPromise).toEqual({total: 1, synced: 0, flagged: 0});

      // The run aborted before any capture was POSTed; everything stays queued
      // and unflagged — nothing for the Beringer to re-save by hand.
      expect((await pendingStore.list()).map((b) => b.id)).toEqual(['local-b']);
      const remaining = await outboxStore.list();
      expect(remaining.map((e) => e.id)).toEqual(['uuid-1']);
      expect(remaining.every((e) => !e.syncError)).toBeTrue();

      // And the Offline-Bereitschaft now tells the truth: veraltet, not bereit.
      expect(appUpdate.versionStale()).toBeTrue();
    });

    it('pauses and prompts a re-login when the session expires on the Beringer create (a 401 in phase 1)', async () => {
      // Same subtlety as the per-entry 401: `syncBeringer` catches its own
      // errors, so this never reaches the run-level `isSessionExpired` handler.
      // Without a remedy the sync just stalls silently until the Beringer
      // happens to re-login of their own accord.
      auth.currentUser.set(authUser());
      await pendingStore.add(makePending());
      await outboxStore.add(
        makeEntry({
          id: 'uuid-1',
          queuedAt: '2026-07-02T09:00:00.000Z',
          payload: {idempotency_key: 'uuid-1', staff_id: 'local-b'},
        }),
      );
      const navigate = spyOn(router, 'navigate').and.stub();

      const resultPromise = firstValueFrom(service.syncNow());
      await settle();
      expectCsrfFetch().flush(meResponse());
      await settle();

      expectScientistPost().flush(
        {detail: 'Authentication credentials were not provided.'},
        {status: 401, statusText: 'Unauthorized'},
      );
      await settle();

      expect(await resultPromise).toEqual({total: 1, synced: 0, flagged: 0});

      // The queue — Beringer and dependent capture alike — is untouched, and
      // resumes on the first sync after a normal re-login.
      expect((await pendingStore.list()).map((b) => b.id)).toEqual(['local-b']);
      const remaining = await outboxStore.list();
      expect(remaining.map((e) => e.id)).toEqual(['uuid-1']);
      expect(remaining[0].syncError).toBeFalsy();

      expect(navigate.calls.mostRecent().args[0]).toEqual(['/login']);
      expect(auth.currentUser()).toBeNull();
      expect(service.syncing()).toBeFalse();
    });
  });
});
