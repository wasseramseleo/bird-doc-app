import {TestBed} from '@angular/core/testing';
import {provideHttpClient} from '@angular/common/http';
import {provideHttpClientTesting} from '@angular/common/http/testing';
import {firstValueFrom} from 'rxjs';

import {PendingBeringerService} from './pending-beringer.service';
import {PendingBeringerStoreService} from '../core/offline/pending-beringer-store';
import {AuthService} from './auth.service';
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

describe('PendingBeringerService', () => {
  let auth: AuthService;
  let store: PendingBeringerStoreService;
  let db: IndexedDbStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    auth = TestBed.inject(AuthService);
    store = TestBed.inject(PendingBeringerStoreService);
    db = TestBed.inject(IndexedDbStore);
    auth.currentUser.set(authUser());
  });

  afterEach(async () => {
    const entries = await db.getAll<{id: string}>('pendingBeringer');
    await Promise.all(entries.map((entry) => db.delete('pendingBeringer', entry.id)));
  });

  it('durably queues a quick-added Beringer stamped with the current account', async () => {
    const service = TestBed.inject(PendingBeringerService);
    await service.ready;

    await firstValueFrom(
      service.enqueue({first_name: 'Filip', last_name: 'Reiter', handle: 'FRE'}),
    );

    const stored = await store.list();
    expect(stored.length).toBe(1);
    expect(stored[0]).toEqual(
      jasmine.objectContaining({
        accountKey: 'fre',
        first_name: 'Filip',
        last_name: 'Reiter',
        handle: 'FRE',
      }),
    );
  });

  it('hands back a selectable placeholder Scientist carrying the queued id, so the same session\'s captures can reference it at once', async () => {
    const service = TestBed.inject(PendingBeringerService);
    await service.ready;

    const placeholder = await firstValueFrom(
      service.enqueue({first_name: 'Filip', last_name: 'Reiter', handle: 'FRE'}),
    );

    const stored = await store.list();
    expect(placeholder.id).toBe(stored[0].id);
    expect(placeholder.handle).toBe('FRE');
    expect(placeholder.full_name).toBe('Filip Reiter');
  });

  it('exposes the account\'s queued Beringer as selectable placeholder Scientists, never another account\'s', async () => {
    await store.add({
      id: 'b-fre',
      accountKey: 'fre',
      first_name: 'Filip',
      last_name: 'Reiter',
      handle: 'FRE',
      queuedAt: '2026-07-02T09:00:00.000Z',
    });
    await store.add({
      id: 'b-anm',
      accountKey: 'anm',
      first_name: 'Anna',
      last_name: 'Muster',
      handle: 'ANM',
      queuedAt: '2026-07-02T09:01:00.000Z',
    });

    const service = TestBed.inject(PendingBeringerService);
    await service.ready;

    expect(service.pendingScientists()).toEqual([
      {id: 'b-fre', handle: 'FRE', full_name: 'Filip Reiter'},
    ]);
  });

  it('lists the current account\'s own queued Beringer oldest-first for sync', async () => {
    await store.add({
      id: 'b2',
      accountKey: 'fre',
      first_name: 'Anna',
      last_name: 'Muster',
      handle: 'ANM',
      queuedAt: '2026-07-02T09:05:00.000Z',
    });
    await store.add({
      id: 'b1',
      accountKey: 'fre',
      first_name: 'Filip',
      last_name: 'Reiter',
      handle: 'FRE',
      queuedAt: '2026-07-02T09:00:00.000Z',
    });

    const service = TestBed.inject(PendingBeringerService);
    await service.ready;

    expect((await service.listOwnQueued()).map((b) => b.id)).toEqual(['b1', 'b2']);
  });

  it('dequeues a synced Beringer and drops it from the placeholder list', async () => {
    const service = TestBed.inject(PendingBeringerService);
    await service.ready;
    const placeholder = await firstValueFrom(
      service.enqueue({first_name: 'Filip', last_name: 'Reiter', handle: 'FRE'}),
    );
    expect(service.pendingScientists().length).toBe(1);

    await service.dequeue(placeholder.id);

    expect(service.pendingScientists()).toEqual([]);
    expect(await store.list()).toEqual([]);
  });
});
