import {TestBed} from '@angular/core/testing';
import {provideHttpClient} from '@angular/common/http';
import {HttpTestingController, provideHttpClientTesting} from '@angular/common/http/testing';
import {Router, provideRouter} from '@angular/router';
import {firstValueFrom} from 'rxjs';

import {SyncService} from './sync.service';
import {AuthService} from './auth.service';
import {OutboxService} from './outbox.service';
import {OutboxStoreService} from '../core/offline/outbox-store';
import {IndexedDbStore} from '../core/offline/indexed-db-store';
import {OutboxEntry} from '../models/outbox-entry.model';
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

    expect(result).toEqual({total: 0, synced: 0});
  });

  it('does nothing when the outbox is empty for the currently authenticated account', async () => {
    auth.currentUser.set(authUser());

    const result = await firstValueFrom(service.syncNow());

    expect(result).toEqual({total: 0, synced: 0});
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
    expect(result).toEqual({total: 1, synced: 1});
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
    expect(result).toEqual({total: 2, synced: 2});
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
    expect(result).toEqual({total: 1, synced: 1});

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
    expect(result).toEqual({total: 2, synced: 1});

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
    expect(await firstRun).toEqual({total: 2, synced: 1});

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

    expect(await secondRun).toEqual({total: 1, synced: 1});
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
    expect(result).toEqual({total: 0, synced: 0});
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
    expect(result).toEqual({total: 2, synced: 1});

    // uuid-2 was never POSTed under 'anm''s session/org, and stays queued
    // under its original account for 'fre''s next sync.
    const remaining = await outboxStore.list();
    expect(remaining.map((e) => e.id)).toEqual(['uuid-2']);
    // The singleton flag must not be left stuck true across the switch —
    // otherwise 'anm''s own "sync on app start" auto-trigger would be a
    // silent no-op.
    expect(service.syncing()).toBeFalse();
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
    expect(result).toEqual({total: 0, synced: 0});
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
    expect(await firstRun).toEqual({total: 0, synced: 0});

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

    expect(await secondRun).toEqual({total: 1, synced: 1});
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
    expect(second).toEqual({total: 0, synced: 0});

    expectCsrfFetch().flush(meResponse());
    await settle();
    expectCreatePost().flush({id: 'server-1'});
    await settle();
    await first;
  });
});
