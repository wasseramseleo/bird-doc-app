import {TestBed} from '@angular/core/testing';
import {firstValueFrom} from 'rxjs';

import {OutboxService} from './outbox.service';
import {OutboxStoreService} from '../core/offline/outbox-store';
import {IndexedDbStore} from '../core/offline/indexed-db-store';

describe('OutboxService', () => {
  let db: IndexedDbStore;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    db = TestBed.inject(IndexedDbStore);
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
});
