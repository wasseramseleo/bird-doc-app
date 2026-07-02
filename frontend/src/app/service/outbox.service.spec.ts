import {TestBed} from '@angular/core/testing';
import {provideHttpClient} from '@angular/common/http';
import {provideHttpClientTesting} from '@angular/common/http/testing';
import {firstValueFrom} from 'rxjs';

import {OutboxService} from './outbox.service';
import {AuthService} from './auth.service';
import {OutboxStoreService} from '../core/offline/outbox-store';
import {IndexedDbStore} from '../core/offline/indexed-db-store';
import {AuthUser} from '../models/auth-user.model';

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

describe('OutboxService', () => {
  let db: IndexedDbStore;
  let auth: AuthService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    db = TestBed.inject(IndexedDbStore);
    auth = TestBed.inject(AuthService);
    auth.currentUser.set(authUser());
  });

  afterEach(async () => {
    await db.delete('outbox', 'uuid-1');
    await db.delete('outbox', 'uuid-2');
  });

  it('starts at a pending count of zero when nothing was ever queued', async () => {
    const service = TestBed.inject(OutboxService);
    await service.ready;

    expect(service.pendingCount()).toBe(0);
  });

  it('durably enqueues a payload and increments the pending count', async () => {
    const service = TestBed.inject(OutboxService);
    await service.ready;

    await firstValueFrom(
      service.enqueue({idempotency_key: 'uuid-1', species_id: 's1', ring_number: '0043'}),
    );

    expect(service.pendingCount()).toBe(1);
    const stored = await TestBed.inject(OutboxStoreService).list();
    expect(stored).toEqual([
      jasmine.objectContaining({
        id: 'uuid-1',
        accountKey: 'fre',
        payload: {idempotency_key: 'uuid-1', species_id: 's1', ring_number: '0043'},
      }),
    ]);
  });

  it('accumulates the pending count across multiple enqueues', async () => {
    const service = TestBed.inject(OutboxService);
    await service.ready;

    await firstValueFrom(service.enqueue({idempotency_key: 'uuid-1'}));
    await firstValueFrom(service.enqueue({idempotency_key: 'uuid-2'}));

    expect(service.pendingCount()).toBe(2);
  });

  it('restores the pending count from a previous session on construction (reload survival)', async () => {
    // Seed the durable store directly, as if a previous session (before this
    // reload) had queued a capture — the service must reflect it without any
    // enqueue() call of its own.
    await TestBed.inject(OutboxStoreService).add({
      id: 'uuid-1',
      accountKey: 'fre',
      payload: {species_id: 's1'},
      queuedAt: '2026-07-02T09:00:00.000Z',
    });

    const service = TestBed.inject(OutboxService);
    await service.ready;

    expect(service.pendingCount()).toBe(1);
  });

  it('refuses to enqueue a payload with no idempotency_key', async () => {
    const service = TestBed.inject(OutboxService);
    await service.ready;

    expect(() => service.enqueue({species_id: 's1'})).toThrowError();
  });

  describe('tenancy (issue #160 fix — a shared/offline device never leaks another account\'s queue)', () => {
    it('refuses to enqueue a payload when no account is authenticated', async () => {
      auth.currentUser.set(null);
      const service = TestBed.inject(OutboxService);
      await service.ready;

      expect(() => service.enqueue({idempotency_key: 'uuid-1'})).toThrowError();
    });

    it('does not count another account\'s queued entries towards the pending count', async () => {
      // Seed as if Mitglied A ("fre") had queued a capture on this shared
      // device in a previous session.
      await TestBed.inject(OutboxStoreService).add({
        id: 'uuid-1',
        accountKey: 'fre',
        payload: {species_id: 's1'},
        queuedAt: '2026-07-02T09:00:00.000Z',
      });

      // Mitglied B logs in on the same device.
      auth.currentUser.set(authUser({username: 'anm', handle: 'ANM'}));
      const service = TestBed.inject(OutboxService);
      await service.ready;

      expect(service.pendingCount()).toBe(0);
    });

    it('reacts to an account switch without a reload — logging out then in as someone else updates the count immediately', async () => {
      await TestBed.inject(OutboxStoreService).add({
        id: 'uuid-1',
        accountKey: 'fre',
        payload: {species_id: 's1'},
        queuedAt: '2026-07-02T09:00:00.000Z',
      });

      const service = TestBed.inject(OutboxService);
      await service.ready;
      expect(service.pendingCount()).toBe(1);

      // Logout (currentUser -> null), then a different Mitglied logs in.
      auth.currentUser.set(null);
      expect(service.pendingCount()).toBe(0);

      auth.currentUser.set(authUser({username: 'anm', handle: 'ANM'}));
      expect(service.pendingCount()).toBe(0);

      // Switching back to the original account restores its own count.
      auth.currentUser.set(authUser({username: 'fre'}));
      expect(service.pendingCount()).toBe(1);
    });

    it('stamps an enqueued entry with the currently authenticated account', async () => {
      const service = TestBed.inject(OutboxService);
      await service.ready;

      await firstValueFrom(service.enqueue({idempotency_key: 'uuid-1'}));

      const stored = await TestBed.inject(OutboxStoreService).listForAccount('fre');
      expect(stored.map((e) => e.id)).toEqual(['uuid-1']);
    });
  });

  describe('pendingEntries() / findQueued() (issue #163 — today\'s session)', () => {
    it('lists the current account\'s queued entries, oldest-first', async () => {
      await TestBed.inject(OutboxStoreService).add({
        id: 'uuid-2',
        accountKey: 'fre',
        payload: {species_id: 's2'},
        queuedAt: '2026-07-02T09:05:00.000Z',
      });
      await TestBed.inject(OutboxStoreService).add({
        id: 'uuid-1',
        accountKey: 'fre',
        payload: {species_id: 's1'},
        queuedAt: '2026-07-02T09:00:00.000Z',
      });

      const service = TestBed.inject(OutboxService);
      await service.ready;

      expect(service.pendingEntries().map((e) => e.id)).toEqual(['uuid-1', 'uuid-2']);
    });

    it('excludes another account\'s queued entries from pendingEntries()', async () => {
      await TestBed.inject(OutboxStoreService).add({
        id: 'uuid-1',
        accountKey: 'anm',
        payload: {},
        queuedAt: '2026-07-02T09:00:00.000Z',
      });

      const service = TestBed.inject(OutboxService);
      await service.ready;

      expect(service.pendingEntries()).toEqual([]);
    });

    it('findQueued() resolves an id queued by the current account', async () => {
      await TestBed.inject(OutboxStoreService).add({
        id: 'uuid-1',
        accountKey: 'fre',
        payload: {species_id: 's1'},
        queuedAt: '2026-07-02T09:00:00.000Z',
      });

      const service = TestBed.inject(OutboxService);
      await service.ready;

      expect(service.findQueued('uuid-1')?.payload).toEqual({species_id: 's1'});
    });

    it('findQueued() returns null for an id queued by a different account (tenancy)', async () => {
      await TestBed.inject(OutboxStoreService).add({
        id: 'uuid-1',
        accountKey: 'anm',
        payload: {species_id: 's1'},
        queuedAt: '2026-07-02T09:00:00.000Z',
      });

      const service = TestBed.inject(OutboxService);
      await service.ready;

      expect(service.findQueued('uuid-1')).toBeNull();
    });

    it('findQueued() returns null for a server id that was never queued', async () => {
      const service = TestBed.inject(OutboxService);
      await service.ready;

      expect(service.findQueued('server-42')).toBeNull();
    });
  });

  describe('update() (issue #163 — editing a queued entry re-queues it)', () => {
    it('overwrites the payload of a queued entry, keeping its id and capture order (queuedAt)', async () => {
      await TestBed.inject(OutboxStoreService).add({
        id: 'uuid-1',
        accountKey: 'fre',
        payload: {species_id: 's1', ring_number: '0043'},
        queuedAt: '2026-07-02T09:00:00.000Z',
      });
      const service = TestBed.inject(OutboxService);
      await service.ready;

      await firstValueFrom(service.update('uuid-1', {species_id: 's1', ring_number: '0099'}));

      expect(service.pendingEntries()).toEqual([
        jasmine.objectContaining({
          id: 'uuid-1',
          accountKey: 'fre',
          queuedAt: '2026-07-02T09:00:00.000Z',
          payload: {species_id: 's1', ring_number: '0099'},
        }),
      ]);
      const stored = await TestBed.inject(OutboxStoreService).listForAccount('fre');
      expect(stored[0].payload).toEqual({species_id: 's1', ring_number: '0099'});
    });

    it('throws when the id is not queued for the current account (tenancy)', async () => {
      await TestBed.inject(OutboxStoreService).add({
        id: 'uuid-1',
        accountKey: 'anm',
        payload: {species_id: 's1'},
        queuedAt: '2026-07-02T09:00:00.000Z',
      });
      const service = TestBed.inject(OutboxService);
      await service.ready;

      expect(() => service.update('uuid-1', {species_id: 's2'})).toThrowError();
    });
  });

  describe('delete() (issue #163 — deleting a queued entry)', () => {
    it('removes a queued entry from the store and the pending list', async () => {
      await TestBed.inject(OutboxStoreService).add({
        id: 'uuid-1',
        accountKey: 'fre',
        payload: {species_id: 's1'},
        queuedAt: '2026-07-02T09:00:00.000Z',
      });
      const service = TestBed.inject(OutboxService);
      await service.ready;
      expect(service.pendingCount()).toBe(1);

      await firstValueFrom(service.delete('uuid-1'));

      expect(service.pendingCount()).toBe(0);
      const stored = await TestBed.inject(OutboxStoreService).listForAccount('fre');
      expect(stored).toEqual([]);
    });

    it('throws when the id is not queued for the current account (tenancy)', async () => {
      await TestBed.inject(OutboxStoreService).add({
        id: 'uuid-1',
        accountKey: 'anm',
        payload: {},
        queuedAt: '2026-07-02T09:00:00.000Z',
      });
      const service = TestBed.inject(OutboxService);
      await service.ready;

      expect(() => service.delete('uuid-1')).toThrowError();
    });
  });
});
