import {ComponentFixture, TestBed} from '@angular/core/testing';
import {provideHttpClient} from '@angular/common/http';
import {HttpTestingController, provideHttpClientTesting} from '@angular/common/http/testing';
import {provideNoopAnimations} from '@angular/platform-browser/animations';
import {MatSnackBar} from '@angular/material/snack-bar';
import {EMPTY, firstValueFrom} from 'rxjs';

import {OutboxIndicator} from './outbox-indicator';
import {OutboxService} from '../../service/outbox.service';
import {AuthService} from '../../service/auth.service';
import {IndexedDbStore} from '../../core/offline/indexed-db-store';

/** Real elapsed time, not a microtask `await` — the sync replay's own reads
 * and writes go through the real browser IndexedDB (`OutboxStoreService`),
 * exactly like `offline-readiness.spec.ts`'s `settle()`. Needed after every
 * step that triggers a sync (a click, an "online" event, mounting a fresh
 * component) *before* the first `httpMock.expectOne()` — the trigger itself
 * always starts with a real IndexedDB read (`listForAccount()`), so the CSRF
 * GET is not dispatched synchronously. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

function meResponse() {
  return {
    username: 'fre',
    handle: 'FRE',
    is_staff: false,
    active_organization_rolle: 'mitglied',
    active_organization: null,
  };
}

// Material services resolve through the component's own injector, so spy on
// the instance the component actually holds (not TestBed.inject, which can
// differ) — mirrors stationen.spec.ts's spyOnSnackBar().
function spyOnSnackBar(fixture: ComponentFixture<OutboxIndicator>) {
  return spyOn(fixture.debugElement.injector.get(MatSnackBar), 'open').and.returnValue({
    onAction: () => EMPTY,
  } as never);
}

describe('OutboxIndicator', () => {
  let fixture: ComponentFixture<OutboxIndicator>;
  let outbox: OutboxService;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [OutboxIndicator],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideNoopAnimations()],
    });
    TestBed.inject(AuthService).currentUser.set({
      username: 'fre',
      handle: 'FRE',
      isStaff: false,
      rolle: 'mitglied',
      organization: null,
    });
    outbox = TestBed.inject(OutboxService);
    httpMock = TestBed.inject(HttpTestingController);
    await outbox.ready;
    fixture = TestBed.createComponent(OutboxIndicator);
    fixture.detectChanges();
    // The constructor's own app-start auto-sync (issue #161) starts against
    // an empty outbox at this point, so it never makes an HTTP call — but it
    // still round-trips through the real IndexedDB (`listForAccount()`)
    // before resolving. Settle it here so every test starts from an idle
    // sync state instead of racing that no-op.
    await settle();
  });

  afterEach(async () => {
    httpMock.verify();
    const db = TestBed.inject(IndexedDbStore);
    await db.delete('outbox', 'uuid-1');
    await db.delete('outbox', 'uuid-2');
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

  describe('synchronisieren (issue #161)', () => {
    it('offers a "Jetzt synchronisieren" action that replays a queued entry and removes it from the pending count', async () => {
      spyOnSnackBar(fixture);
      await firstValueFrom(outbox.enqueue({idempotency_key: 'uuid-1', species_id: 's1'}));
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('1 nicht synchronisierte Einträge');

      const button = fixture.nativeElement.querySelector(
        '.outbox-indicator__sync',
      ) as HTMLButtonElement;
      expect(button).withContext('manual "Jetzt synchronisieren" action').not.toBeNull();

      button.click();
      fixture.detectChanges();
      await settle();

      const csrfReq = httpMock.expectOne((r) => r.method === 'GET' && r.url.endsWith('/auth/me/'));
      csrfReq.flush(meResponse());
      await settle();

      const postReq = httpMock.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'),
      );
      postReq.flush({id: 'server-1'});
      await settle();
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain('0 nicht synchronisierte Einträge');
    });

    it('shows completion feedback once a sync finishes', async () => {
      const snackBarSpy = spyOnSnackBar(fixture);
      await firstValueFrom(outbox.enqueue({idempotency_key: 'uuid-1', species_id: 's1'}));
      fixture.detectChanges();

      (fixture.nativeElement.querySelector('.outbox-indicator__sync') as HTMLButtonElement).click();
      fixture.detectChanges();
      await settle();

      httpMock.expectOne((r) => r.url.endsWith('/auth/me/')).flush(meResponse());
      await settle();
      httpMock.expectOne((r) => r.url.endsWith('/birds/data-entries/')).flush({id: 'server-1'});
      await settle();

      expect(snackBarSpy).toHaveBeenCalledWith(
        '1 von 1 Einträgen synchronisiert.',
        'Schließen',
        jasmine.objectContaining({duration: 3000}),
      );
    });

    it('shows partial-completion feedback when a sync is interrupted', async () => {
      const snackBarSpy = spyOnSnackBar(fixture);
      await firstValueFrom(outbox.enqueue({idempotency_key: 'uuid-1', species_id: 's1'}));
      await firstValueFrom(outbox.enqueue({idempotency_key: 'uuid-2', species_id: 's2'}));
      fixture.detectChanges();

      (fixture.nativeElement.querySelector('.outbox-indicator__sync') as HTMLButtonElement).click();
      fixture.detectChanges();
      await settle();

      httpMock.expectOne((r) => r.url.endsWith('/auth/me/')).flush(meResponse());
      await settle();
      httpMock.expectOne((r) => r.url.endsWith('/birds/data-entries/')).flush({id: 'server-1'});
      await settle();
      httpMock
        .expectOne((r) => r.url.endsWith('/birds/data-entries/'))
        .error(new ProgressEvent('error'));
      await settle();

      expect(snackBarSpy).toHaveBeenCalledWith(
        '1 von 2 Einträgen synchronisiert – der Rest folgt automatisch.',
        'Schließen',
        jasmine.objectContaining({duration: 3000}),
      );
    });

    it('calls out flagged (server-rejected) entries separately in the feedback (issue #164)', async () => {
      const snackBarSpy = spyOnSnackBar(fixture);
      await firstValueFrom(outbox.enqueue({idempotency_key: 'uuid-1', species_id: 's1'}));
      await firstValueFrom(outbox.enqueue({idempotency_key: 'uuid-2', species_id: 's2'}));
      fixture.detectChanges();

      (fixture.nativeElement.querySelector('.outbox-indicator__sync') as HTMLButtonElement).click();
      fixture.detectChanges();
      await settle();

      httpMock.expectOne((r) => r.url.endsWith('/auth/me/')).flush(meResponse());
      await settle();
      httpMock.expectOne((r) => r.url.endsWith('/birds/data-entries/')).flush({id: 'server-1'});
      await settle();
      // uuid-2 is rejected by the server (a 4xx) — skipped and flagged.
      httpMock
        .expectOne((r) => r.url.endsWith('/birds/data-entries/'))
        .flush({ring_number: ['Ring bereits vergeben.']}, {status: 400, statusText: 'Bad Request'});
      await settle();

      expect(snackBarSpy).toHaveBeenCalledWith(
        '1 von 2 Einträgen synchronisiert, 1 mit Fehler markiert.',
        'Schließen',
        jasmine.objectContaining({duration: 3000}),
      );
    });

    it('triggers a sync automatically as soon as it is shown (app start), when an entry is already queued', async () => {
      // Simulates a reload: the entry was queued by a previous session, so a
      // freshly-created component must replay it with no user action.
      await firstValueFrom(outbox.enqueue({idempotency_key: 'uuid-1', species_id: 's1'}));

      const freshFixture = TestBed.createComponent(OutboxIndicator);
      spyOnSnackBar(freshFixture);
      freshFixture.detectChanges();
      await settle();

      const csrfReq = httpMock.expectOne((r) => r.url.endsWith('/auth/me/'));
      csrfReq.flush(meResponse());
      await settle();
      httpMock.expectOne((r) => r.url.endsWith('/birds/data-entries/')).flush({id: 'server-1'});
      await settle();
    });

    it('reacts automatically when connectivity returns (window "online" event)', async () => {
      spyOnSnackBar(fixture);
      await firstValueFrom(outbox.enqueue({idempotency_key: 'uuid-1', species_id: 's1'}));

      window.dispatchEvent(new Event('online'));
      await settle();

      const csrfReq = httpMock.expectOne((r) => r.url.endsWith('/auth/me/'));
      csrfReq.flush(meResponse());
      await settle();
      httpMock.expectOne((r) => r.url.endsWith('/birds/data-entries/')).flush({id: 'server-1'});
      await settle();
    });

    it('disables the manual action while a sync is in progress', async () => {
      spyOnSnackBar(fixture);
      await firstValueFrom(outbox.enqueue({idempotency_key: 'uuid-1', species_id: 's1'}));
      fixture.detectChanges();

      const button = fixture.nativeElement.querySelector(
        '.outbox-indicator__sync',
      ) as HTMLButtonElement;
      button.click();
      fixture.detectChanges();
      expect(button.disabled).toBeTrue();

      await settle();
      httpMock.expectOne((r) => r.url.endsWith('/auth/me/')).flush(meResponse());
      await settle();
      httpMock.expectOne((r) => r.url.endsWith('/birds/data-entries/')).flush({id: 'server-1'});
      await settle();
      fixture.detectChanges();

      expect(button.disabled).toBeFalse();
    });
  });
});
