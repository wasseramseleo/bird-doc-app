import {ComponentFixture, TestBed} from '@angular/core/testing';
import {provideHttpClient} from '@angular/common/http';
import {HttpTestingController, provideHttpClientTesting} from '@angular/common/http/testing';
import {provideNoopAnimations} from '@angular/platform-browser/animations';
import {MatSnackBar} from '@angular/material/snack-bar';
import {EMPTY, firstValueFrom} from 'rxjs';

import {OutboxIndicator} from './outbox-indicator';
import {OutboxService} from '../../service/outbox.service';
import {AuthService} from '../../service/auth.service';
import {SyncService} from '../../service/sync.service';
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

  it('shows a friendly green "Alle Einträge synchronisiert" while nothing is queued (always-visible, even at zero)', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.outbox-indicator')).withContext('always mounted').not.toBeNull();
    expect(el.textContent).toContain('Alle Einträge synchronisiert');
    expect(el.textContent).not.toContain('nicht synchronisiert');
  });

  it('marks the all-synced state with the --bd-success token and a check_circle icon', () => {
    const el: HTMLElement = fixture.nativeElement;
    const indicator = el.querySelector('.outbox-indicator') as HTMLElement;
    expect(indicator.classList).withContext('green all-synced modifier').toContain(
      'outbox-indicator--synced',
    );
    const icon = el.querySelector('.outbox-indicator__icon') as HTMLElement;
    expect(icon.textContent?.trim()).toBe('check_circle');
  });

  it('hides the "Jetzt synchronisieren" button in the all-synced state (nothing to sync)', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.outbox-indicator__sync')).withContext('no manual sync at 0').toBeNull();
  });

  it('shows a neutral pending count and the manual sync button once captures are queued', async () => {
    await firstValueFrom(outbox.enqueue({idempotency_key: 'uuid-1', species_id: 's1'}));
    await firstValueFrom(outbox.enqueue({idempotency_key: 'uuid-2', species_id: 's2'}));
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const indicator = el.querySelector('.outbox-indicator') as HTMLElement;
    expect(indicator.classList).withContext('not green while pending').not.toContain(
      'outbox-indicator--synced',
    );
    expect(el.textContent).toContain('2 nicht synchronisierte Einträge');
    expect(el.querySelector('.outbox-indicator__sync')).withContext('manual sync stays').not.toBeNull();
  });

  it('uses the singular for exactly one pending entry', async () => {
    await firstValueFrom(outbox.enqueue({idempotency_key: 'uuid-1', species_id: 's1'}));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('1 nicht synchronisierter Eintrag');
    expect(fixture.nativeElement.textContent).not.toContain('nicht synchronisierte Einträge');
  });

  describe('synchronisieren (issue #161)', () => {
    it('offers a "Jetzt synchronisieren" action that replays a queued entry and removes it from the pending count', async () => {
      spyOnSnackBar(fixture);
      await firstValueFrom(outbox.enqueue({idempotency_key: 'uuid-1', species_id: 's1'}));
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('1 nicht synchronisierter Eintrag');

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

      expect(fixture.nativeElement.textContent).toContain('Alle Einträge synchronisiert');
      expect(fixture.nativeElement.querySelector('.outbox-indicator__sync')).toBeNull();
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

    it('fires the app-start and "online" auto-sync even in the all-synced state, where the manual button is hidden', () => {
      // The outbox is empty here, so the button is not rendered — yet the
      // constructor's app-start trigger and the window "online" trigger must
      // still fire, because they hang off the component, not off the button.
      // The beforeEach fixture is still mounted and also listens for "online";
      // destroy it so this test observes only the fresh component's triggers.
      fixture.destroy();
      const syncSpy = spyOn(TestBed.inject(SyncService), 'syncNow').and.returnValue(EMPTY);

      const freshFixture = TestBed.createComponent(OutboxIndicator);
      freshFixture.detectChanges();

      expect(
        freshFixture.nativeElement.querySelector('.outbox-indicator__sync'),
      ).withContext('button hidden at 0').toBeNull();
      expect(syncSpy).withContext('app-start auto-sync').toHaveBeenCalledTimes(1);

      window.dispatchEvent(new Event('online'));
      expect(syncSpy).withContext('online auto-sync').toHaveBeenCalledTimes(2);

      freshFixture.destroy();
    });

    it('disables the manual action while a sync is in progress and re-enables it once entries remain', async () => {
      spyOnSnackBar(fixture);
      // Two entries so that one can fail and stay queued — keeping the button
      // rendered afterwards. (A fully-drained outbox drops to the 0-state,
      // where the button is intentionally gone, so there is nothing to re-enable.)
      await firstValueFrom(outbox.enqueue({idempotency_key: 'uuid-1', species_id: 's1'}));
      await firstValueFrom(outbox.enqueue({idempotency_key: 'uuid-2', species_id: 's2'}));
      fixture.detectChanges();

      (fixture.nativeElement.querySelector('.outbox-indicator__sync') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(
        (fixture.nativeElement.querySelector('.outbox-indicator__sync') as HTMLButtonElement)
          .disabled,
      ).toBeTrue();

      await settle();
      httpMock.expectOne((r) => r.url.endsWith('/auth/me/')).flush(meResponse());
      await settle();
      httpMock.expectOne((r) => r.url.endsWith('/birds/data-entries/')).flush({id: 'server-1'});
      await settle();
      // Second entry is rejected and stays queued, so the outbox is not empty.
      httpMock
        .expectOne((r) => r.url.endsWith('/birds/data-entries/'))
        .error(new ProgressEvent('error'));
      await settle();
      fixture.detectChanges();

      const button = fixture.nativeElement.querySelector(
        '.outbox-indicator__sync',
      ) as HTMLButtonElement;
      expect(button).withContext('button still shown while an entry remains').not.toBeNull();
      expect(button.disabled).toBeFalse();
    });
  });
});
