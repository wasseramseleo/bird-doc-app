import {TestBed} from '@angular/core/testing';

import {IndexedDbStore} from './indexed-db-store';

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
});
