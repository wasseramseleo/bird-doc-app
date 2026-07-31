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

  describe('a blocked open (issue #464)', () => {
    // `blocked` fires when an open needs a version change while an older
    // connection is still open. Unhandled, the request neither succeeds nor
    // errors — it simply hangs, and whoever awaited it hangs with it. That is
    // the one failure mode a spec can never recover from, so it must reject.
    // Only the *first* open blocks — every later one is the real thing. The
    // shared `afterEach` above still has to be able to clean up, and a spy that
    // blocked forever would take it down with an error that says nothing.
    function blockOnlyTheFirstOpen(): void {
      const originalOpen = indexedDB.open.bind(indexedDB);
      let attempt = 0;
      spyOn(indexedDB, 'open').and.callFake((name: string, version?: number): IDBOpenDBRequest => {
        if (++attempt > 1) {
          return originalOpen(name, version);
        }
        const request = {error: null} as unknown as IDBOpenDBRequest;
        queueMicrotask(() => request.onblocked?.(new Event('blocked') as IDBVersionChangeEvent));
        return request;
      });
    }

    it('rejects instead of hanging when the open is blocked by an older connection', async () => {
      blockOnlyTheFirstOpen();

      await expectAsync(store.get('identity', 'k1')).toBeRejected();
    });

    it('closes the connection a blocked open still hands back once it completes', async () => {
      // `blocked` does not cancel the open — the browser finishes it as soon as
      // the older connection goes. By then the caller has been rejected and
      // nobody holds the result, so it has to be closed here or it is exactly
      // the leaked handle this whole change is about.
      const close = spyOn(IDBDatabase.prototype, 'close').and.callThrough();
      const originalOpen = indexedDB.open.bind(indexedDB);
      let blockedRequest: IDBOpenDBRequest | undefined;
      let attempt = 0;
      spyOn(indexedDB, 'open').and.callFake((name: string, version?: number): IDBOpenDBRequest => {
        const request = originalOpen(name, version);
        if (++attempt === 1) {
          blockedRequest = request;
          queueMicrotask(() => request.onblocked?.(new Event('blocked') as IDBVersionChangeEvent));
        }
        return request;
      });

      await expectAsync(store.get('identity', 'k1')).toBeRejected();
      // The browser never cancelled that open — wait for it to finish anyway.
      while (blockedRequest!.readyState !== 'done') {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      expect(blockedRequest!.result).toBeTruthy();
      expect(close).toHaveBeenCalled();
    });

    it('lets the next call retry, rather than wedging the store for the rest of the page', async () => {
      blockOnlyTheFirstOpen();

      await expectAsync(store.put('identity', 'k1', {foo: 'bar'})).toBeRejected();

      await store.put('identity', 'k1', {foo: 'bar'});
      expect(await store.get('identity', 'k1')).toEqual({foo: 'bar'});
    });
  });

  describe('closing the connection (issue #464)', () => {
    // In the browser this fires once, at app teardown: one page, one
    // connection, exactly as before. Under Karma every `TestBed` builds a new
    // root injector and so a new `IndexedDbStore`, and each reset destroys it —
    // which is what stops ~1300 specs from stacking up open handles on the one
    // shared `birddoc-offline` and blocking each other's opens.
    it('closes the open connection when the injector that created it is destroyed', async () => {
      await store.put('identity', 'k1', {foo: 'bar'});
      const close = spyOn(IDBDatabase.prototype, 'close').and.callThrough();

      TestBed.resetTestingModule();
      // The close waits on the open it is closing, so it lands a turn later.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(close).toHaveBeenCalled();
    });

    it('re-opens on the next call after being closed, rather than handing back a dead handle', async () => {
      await store.put('identity', 'k1', {foo: 'bar'});

      store.ngOnDestroy();

      expect(await store.get('identity', 'k1')).toEqual({foo: 'bar'});
    });
  });

  describe('whenIdle() (issue #464)', () => {
    // The seam that lets a spec await the *real* IndexedDB round-trip instead
    // of guessing at it with `setTimeout(…, 20)`. The guess is what made the
    // suite wander: the work is unpatched by Zone, so neither `whenStable()`
    // nor a microtask await observes it, and a 20 ms budget is simply lost
    // whenever the machine is momentarily busy.
    it('does not resolve until an in-flight write has actually completed', async () => {
      let written = false;
      const write = store.put('identity', 'k1', {foo: 'bar'}).then(() => {
        written = true;
      });

      await store.whenIdle();

      expect(written).toBe(true);
      await write;
    });

    it('also waits out work queued by the completion of earlier work', async () => {
      let chained = false;
      void store.put('identity', 'k1', {foo: 'bar'}).then(() =>
        store.get('identity', 'k1').then(() => {
          chained = true;
        }),
      );

      await store.whenIdle();

      expect(chained).toBe(true);
    });

    it('resolves when the store has nothing in flight', async () => {
      await expectAsync(store.whenIdle()).toBeResolved();
    });

    it('gives up with a sentence naming the cause rather than spinning forever', async () => {
      // An open that never settles either way — the one shape that would
      // otherwise leave `whenIdle()` polling for the rest of the run. Only the
      // first open hangs, so the shared `afterEach` can still clean up.
      const originalOpen = indexedDB.open.bind(indexedDB);
      let attempt = 0;
      spyOn(indexedDB, 'open').and.callFake((name: string, version?: number): IDBOpenDBRequest =>
        ++attempt > 1
          ? originalOpen(name, version)
          : ({error: null} as unknown as IDBOpenDBRequest),
      );
      void store.get('identity', 'k1');

      // Elapsed time, simulated: the ceiling is 10 s and no spec should sit
      // through it. The first reading sets the deadline, every later one is
      // already past it.
      const startedAt = Date.now();
      let reading = 0;
      spyOn(Date, 'now').and.callFake(() => (++reading > 1 ? startedAt + 11_000 : startedAt));

      await expectAsync(store.whenIdle()).toBeRejectedWithError(/never settled/);

      // Drop the hung open so the cleanup below re-opens for real.
      store.ngOnDestroy();
    });
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
