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
});
