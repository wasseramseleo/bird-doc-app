import {TestBed} from '@angular/core/testing';

import {PendingBeringerStoreService} from './pending-beringer-store';
import {IndexedDbStore} from './indexed-db-store';
import {PendingBeringer} from '../../models/pending-beringer.model';

/**
 * Unit tests for the pure IndexedDB read/write layer of the offline
 * quick-added-Beringer queue (issue #167, PRD #152). Exercises the real
 * ("faked") browser IndexedDB, exactly like `outbox-store.spec.ts`.
 */

function makePending(overrides: Partial<PendingBeringer> = {}): PendingBeringer {
  return {
    id: 'b1',
    accountKey: 'fre',
    first_name: 'Filip',
    last_name: 'Reiter',
    handle: 'FRE',
    queuedAt: '2026-07-02T09:00:00.000Z',
    ...overrides,
  };
}

describe('PendingBeringerStoreService', () => {
  let store: PendingBeringerStoreService;
  let db: IndexedDbStore;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(PendingBeringerStoreService);
    db = TestBed.inject(IndexedDbStore);
  });

  afterEach(async () => {
    await db.delete('pendingBeringer', 'b1');
    await db.delete('pendingBeringer', 'b2');
    await db.delete('pendingBeringer', 'b3');
  });

  it('durably stores a quick-added Beringer and lists it back', async () => {
    await store.add(makePending());

    expect(await store.list()).toEqual([makePending()]);
  });

  it('lists every stored Beringer oldest-first (quick-add order)', async () => {
    await store.add(makePending({id: 'b2', handle: 'ANM', queuedAt: '2026-07-02T09:05:00.000Z'}));
    await store.add(makePending({id: 'b1', handle: 'FRE', queuedAt: '2026-07-02T09:00:00.000Z'}));

    expect((await store.list()).map((b) => b.id)).toEqual(['b1', 'b2']);
  });

  it('lists only a given account\'s Beringer (tenancy boundary)', async () => {
    await store.add(makePending({id: 'b1', accountKey: 'fre'}));
    await store.add(makePending({id: 'b2', accountKey: 'anm'}));

    const mine = await store.listForAccount('fre');

    expect(mine.map((b) => b.id)).toEqual(['b1']);
  });

  it('removes a synced Beringer', async () => {
    await store.add(makePending());

    await store.remove('b1');

    expect(await store.list()).toEqual([]);
  });
});
