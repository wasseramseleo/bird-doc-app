import {ComponentFixture, TestBed} from '@angular/core/testing';
import {firstValueFrom} from 'rxjs';

import {OutboxIndicator} from './outbox-indicator';
import {OutboxService} from '../../service/outbox.service';
import {IndexedDbStore} from '../../core/offline/indexed-db-store';

describe('OutboxIndicator', () => {
  let fixture: ComponentFixture<OutboxIndicator>;
  let outbox: OutboxService;

  beforeEach(async () => {
    TestBed.configureTestingModule({imports: [OutboxIndicator]});
    outbox = TestBed.inject(OutboxService);
    await outbox.ready;
    fixture = TestBed.createComponent(OutboxIndicator);
    fixture.detectChanges();
  });

  afterEach(async () => {
    await TestBed.inject(IndexedDbStore).delete('outbox', 'uuid-1');
  });

  it('shows "0 nicht synchronisierte Einträge" while nothing is queued (always-visible, even at zero)', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.outbox-indicator')).withContext('always mounted').not.toBeNull();
    expect(el.textContent).toContain('0 nicht synchronisierte Einträge');
  });

  it('shows the pending count once a capture is queued', async () => {
    await firstValueFrom(outbox.enqueue({idempotency_key: 'uuid-1', species_id: 's1'}));
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('1 nicht synchronisierte Einträge');
  });
});
