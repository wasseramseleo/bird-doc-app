import {TestBed} from '@angular/core/testing';

import {
  ensureOfflineStores,
  IndexedDbStore,
  OFFLINE_DB_VERSION,
  OFFLINE_STORES,
} from './indexed-db-store';
import {OutboxEntry} from '../../models/outbox-entry.model';

describe('IndexedDbStore', () => {
  let store: IndexedDbStore;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(IndexedDbStore);
  });

  afterEach(async () => {
    await store.delete('identity', 'k1');
  });

  it('round-trips a value written with put()', async () => {
    await store.put('identity', 'k1', {foo: 'bar'});

    const result = await store.get('identity', 'k1');

    expect(result).toEqual({foo: 'bar'});
  });

  it('returns undefined for a key that was never written', async () => {
    const result = await store.get('identity', 'never-written');

    expect(result).toBeUndefined();
  });

  it('overwrites the value on a second put() with the same key', async () => {
    await store.put('identity', 'k1', {foo: 'bar'});
    await store.put('identity', 'k1', {foo: 'baz'});

    const result = await store.get('identity', 'k1');

    expect(result).toEqual({foo: 'baz'});
  });

  it('removes the value with delete()', async () => {
    await store.put('identity', 'k1', {foo: 'bar'});

    await store.delete('identity', 'k1');

    const result = await store.get('identity', 'k1');
    expect(result).toBeUndefined();
  });

  it('recovers on the next call after a failed open, instead of staying wedged for the session', async () => {
    const originalOpen = indexedDB.open.bind(indexedDB);
    let attempt = 0;
    spyOn(indexedDB, 'open').and.callFake((name: string, version?: number): IDBOpenDBRequest => {
      attempt++;
      if (attempt === 1) {
        const failingRequest = {error: new DOMException('boom', 'UnknownError')} as unknown as IDBOpenDBRequest;
        queueMicrotask(() => failingRequest.onerror?.(new Event('error')));
        return failingRequest;
      }
      return originalOpen(name, version);
    });

    await expectAsync(store.put('identity', 'k1', {foo: 'bar'})).toBeRejected();

    // A second call must not reuse the poisoned, already-rejected open promise.
    await store.put('identity', 'k1', {foo: 'bar'});
    const result = await store.get('identity', 'k1');

    expect(result).toEqual({foo: 'bar'});
  });

  describe('getAll() (issue #160, the offline outbox)', () => {
    afterEach(async () => {
      await store.delete('outbox', 'o1');
      await store.delete('outbox', 'o2');
    });

    it('returns an empty array when the store has never been written to', async () => {
      const result = await store.getAll('outbox');

      expect(result).toEqual([]);
    });

    it('returns every value put into the store, regardless of key', async () => {
      await store.put('outbox', 'o1', {foo: 'bar'});
      await store.put('outbox', 'o2', {foo: 'baz'});

      const result = await store.getAll('outbox');

      expect(result).toEqual(jasmine.arrayWithExactContents([{foo: 'bar'}, {foo: 'baz'}]));
    });
  });

  describe('the upgrade to v6 (issue #445 — the flagged entry gains its envelope)', () => {
    // Driven through the real upgrade handler on a database of this spec's own,
    // never on the app's shared `birddoc-offline`: the version of a database is
    // per-origin and permanent, so re-opening the shared one at an *older*
    // version is a `VersionError` the moment any other spec has already opened
    // it — an order-dependent failure that says nothing about the upgrade.
    const DB_NAME = 'birddoc-offline-upgrade-spec';

    // The record a bundle before #445 wrote: a plain string flag, no envelope.
    // Precisely what a device offline for weeks is holding.
    const flaggedByAnOlderBundle: OutboxEntry = {
      id: 'uuid-1',
      accountKey: 'fre',
      payload: {idempotency_key: 'uuid-1', ring_number: '0043'},
      queuedAt: '2026-07-02T09:00:00.000Z',
      syncError: 'Für diese Ringnummer besteht in dieser Organisation bereits ein Erstfang.',
    };

    function open(version: number): Promise<IDBDatabase> {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, version);
        request.onupgradeneeded = () => ensureOfflineStores(request.result);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    function write(db: IDBDatabase, key: string, value: unknown): Promise<void> {
      return new Promise((resolve, reject) => {
        const tx = db.transaction('outbox', 'readwrite');
        tx.objectStore('outbox').put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }

    function read(db: IDBDatabase, key: string): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const request = db.transaction('outbox', 'readonly').objectStore('outbox').get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    afterEach(
      () =>
        new Promise<void>((resolve) => {
          const request = indexedDB.deleteDatabase(DB_NAME);
          request.onsuccess = () => resolve();
          request.onerror = () => resolve();
          request.onblocked = () => resolve();
        }),
    );

    it('versions the record shape: the flagged entry changed, so the database did', () => {
      expect(OFFLINE_DB_VERSION).toBe(6);
    });

    it('carries an entry an older bundle flagged with a plain string through the upgrade untouched', async () => {
      const v5 = await open(5);
      await write(v5, 'uuid-1', flaggedByAnOlderBundle);
      v5.close();

      const v6 = await open(OFFLINE_DB_VERSION);
      const stored = await read(v6, 'uuid-1');
      const storeNames = [...v6.objectStoreNames];
      v6.close();

      // Byte for byte what was written — the string is still readable, and no
      // envelope (and so no code) was invented for it on the way up.
      expect(stored).toEqual(flaggedByAnOlderBundle);
      // And no store was dropped in the process: every offline slice's data
      // survives an upgrade, which is the whole contract of this handler.
      expect(storeNames).toEqual(jasmine.arrayWithExactContents([...OFFLINE_STORES]));
    });
  });
});
