import {TestBed} from '@angular/core/testing';

import {OutboxStoreService} from './outbox-store';
import {IndexedDbStore} from './indexed-db-store';
import {OutboxEntry} from '../../models/outbox-entry.model';

function makeEntry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    id: 'uuid-1',
    accountKey: 'fre',
    payload: {species_id: 's1', ring_number: '0043'},
    queuedAt: '2026-07-02T09:00:00.000Z',
    ...overrides,
  };
}

describe('OutboxStoreService', () => {
  let service: OutboxStoreService;
  let db: IndexedDbStore;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(OutboxStoreService);
    db = TestBed.inject(IndexedDbStore);
  });

  afterEach(async () => {
    await db.delete('outbox', 'uuid-1');
    await db.delete('outbox', 'uuid-2');
    await db.delete('outbox', 'uuid-3');
  });

  it('returns an empty list when nothing has ever been queued', async () => {
    const result = await service.list();

    expect(result).toEqual([]);
  });

  it('round-trips an entry added with add()', async () => {
    const entry = makeEntry();
    await service.add(entry);

    const result = await service.list();

    expect(result).toEqual([entry]);
  });

  it('keyed by id, so re-adding the same idempotency UUID overwrites the row instead of duplicating it', async () => {
    await service.add(makeEntry({payload: {ring_number: '0043'}}));
    await service.add(makeEntry({payload: {ring_number: '0044'}}));

    const result = await service.list();

    expect(result.length).toBe(1);
    expect(result[0].payload).toEqual({ring_number: '0044'});
  });

  it('lists every distinct queued entry, oldest-first by queuedAt (capture order)', async () => {
    const second = makeEntry({id: 'uuid-2', queuedAt: '2026-07-02T09:05:00.000Z'});
    const first = makeEntry({id: 'uuid-1', queuedAt: '2026-07-02T09:00:00.000Z'});
    const third = makeEntry({id: 'uuid-3', queuedAt: '2026-07-02T09:10:00.000Z'});

    // Added out of capture order — list() must still return them sorted.
    await service.add(second);
    await service.add(third);
    await service.add(first);

    const result = await service.list();

    expect(result.map((e) => e.id)).toEqual(['uuid-1', 'uuid-2', 'uuid-3']);
  });

  describe('listForAccount() (issue #160 tenancy fix)', () => {
    it('returns only the entries queued by the given account, oldest-first', async () => {
      const mineFirst = makeEntry({
        id: 'uuid-1',
        accountKey: 'fre',
        queuedAt: '2026-07-02T09:00:00.000Z',
      });
      const someoneElses = makeEntry({
        id: 'uuid-2',
        accountKey: 'anm',
        queuedAt: '2026-07-02T09:02:00.000Z',
      });
      const mineSecond = makeEntry({
        id: 'uuid-3',
        accountKey: 'fre',
        queuedAt: '2026-07-02T09:05:00.000Z',
      });

      await service.add(mineFirst);
      await service.add(someoneElses);
      await service.add(mineSecond);

      const result = await service.listForAccount('fre');

      expect(result.map((e) => e.id)).toEqual(['uuid-1', 'uuid-3']);
    });

    it('returns an empty list for an account that has never queued anything', async () => {
      await service.add(makeEntry({id: 'uuid-1', accountKey: 'fre'}));

      const result = await service.listForAccount('anm');

      expect(result).toEqual([]);
    });
  });

  describe('remove() (issue #161 dropping a synced entry / issue #163 deleting a queued entry)', () => {
    it('removes the entry so it no longer appears in list()', async () => {
      await service.add(makeEntry({id: 'uuid-1'}));
      await service.add(makeEntry({id: 'uuid-2'}));

      await service.remove('uuid-1');

      const result = await service.list();
      expect(result.map((e) => e.id)).toEqual(['uuid-2']);
    });

    it('is a no-op when the id was never queued', async () => {
      await expectAsync(service.remove('never-queued')).toBeResolved();
    });
  });

  it('tolerates roughly two weeks of daily sessions worth of queued entries', async () => {
    const count = 300; // ~2 weeks * ~20 captures/day, rounded up
    for (let i = 0; i < count; i++) {
      await service.add(
        makeEntry({
          id: `uuid-bulk-${i}`,
          queuedAt: new Date(2026, 5, 1, 9, 0, i).toISOString(),
          payload: {ring_number: String(i)},
        }),
      );
    }

    const result = await service.list();

    expect(result.length).toBe(count);
    expect(result[0].payload).toEqual({ring_number: '0'});
    expect(result[count - 1].payload).toEqual({ring_number: String(count - 1)});

    for (let i = 0; i < count; i++) {
      await db.delete('outbox', `uuid-bulk-${i}`);
    }
  });
});
