import {ComponentFixture, TestBed} from '@angular/core/testing';
import {provideHttpClient} from '@angular/common/http';
import {HttpTestingController, provideHttpClientTesting} from '@angular/common/http/testing';
import {MatDialog} from '@angular/material/dialog';
import {SwUpdate, UnrecoverableStateEvent, VersionEvent} from '@angular/service-worker';
import {Subject, of} from 'rxjs';

import {OfflineReadiness} from './offline-readiness';
import {ReferenceBundleCacheService} from '../../core/offline/reference-bundle-cache';
import {OfflineBundle} from '../../models/offline-bundle.model';
import {APP_RELOAD, AppUpdateService} from '../../service/app-update.service';
import {UnsavedChangesService} from '../../service/unsaved-changes.service';
import {ConnectivityService} from '../../core/offline/connectivity';

const BUNDLE: OfflineBundle = {
  identity: {username: 'fre', handle: 'FRE', organization: null, rolle: 'mitglied'},
  species: [],
  ringing_stations: [],
  scientists: [],
  projects: [],
  centrals: [],
  last_consumed_ring_numbers: [],
};

/** The injected browser API, faked in the `pwa-install.service.spec.ts` spirit:
 * ngsw's two event streams as Subjects the spec drives by hand, since no test
 * can make a real service worker discover a new bundle mid-run (PRD #418). */
class FakeSwUpdate {
  readonly isEnabled = true;
  readonly versionUpdates = new Subject<VersionEvent>();
  readonly unrecoverable = new Subject<UnrecoverableStateEvent>();
  readonly activateUpdate = jasmine.createSpy('activateUpdate').and.resolveTo(true);
  readonly checkForUpdate = jasmine.createSpy('checkForUpdate').and.resolveTo(false);
}

interface Harness {
  fixture: ComponentFixture<OfflineReadiness>;
  httpMock: HttpTestingController;
  swUpdate: FakeSwUpdate;
  reload: jasmine.Spy;
  dialog: {open: jasmine.Spy};
}

async function setup(
  options: {persist?: boolean | 'pending'; swUpdate?: FakeSwUpdate} = {},
): Promise<Harness> {
  const {persist = true} = options;
  if (persist === 'pending') {
    spyOn(navigator.storage, 'persist').and.returnValue(new Promise(() => {}));
  } else {
    spyOn(navigator.storage, 'persist').and.resolveTo(persist);
  }

  const swUpdate = options.swUpdate ?? new FakeSwUpdate();
  const reload = jasmine.createSpy('reload');
  const dialog = {open: jasmine.createSpy('open')};
  dialog.open.and.returnValue({afterClosed: () => of(true)});

  TestBed.configureTestingModule({
    imports: [OfflineReadiness],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      {provide: SwUpdate, useValue: swUpdate},
      {provide: APP_RELOAD, useValue: reload},
      {provide: MatDialog, useValue: dialog},
    ],
  });
  const fixture = TestBed.createComponent(OfflineReadiness);
  const httpMock = TestBed.inject(HttpTestingController);
  fixture.detectChanges();
  return {fixture, httpMock, swUpdate, reload, dialog};
}

/** A fake ngsw that *finds* something when asked to look — the real worker
 * announces VERSION_READY as part of the check it runs, so a check that
 * discovers a new bundle leaves a Version waiting. */
function swUpdateThatFindsAVersion(): FakeSwUpdate {
  const swUpdate = new FakeSwUpdate();
  swUpdate.checkForUpdate.and.callFake(async () => {
    emitVersionReady(swUpdate);
    return true;
  });
  return swUpdate;
}

/** ngsw has downloaded a newer Version and is holding it for activation. */
function emitVersionReady(swUpdate: FakeSwUpdate): void {
  swUpdate.versionUpdates.next({
    type: 'VERSION_READY',
    currentVersion: {hash: 'old-hash'},
    latestVersion: {hash: 'new-hash'},
  });
}

/** The refresh chain writes through to the real (unpatched by Zone) browser
 * IndexedDB, so neither `fixture.whenStable()` nor a plain microtask await
 * observes its completion — only real elapsed time does. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

/** Waits for a condition instead of guessing at a delay. How long that real
 * IndexedDB round trip takes depends on what else the suite is doing, so a
 * fixed pause is a bet that is lost only under load — i.e. only on someone
 * else's machine, in someone else's spec. */
async function waitUntil(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** Waits out any refresh in flight, so the "Jetzt aktualisieren" button's
 * `[disabled]="refreshing()"` state has settled. */
async function whenIdle(fixture: ComponentFixture<OfflineReadiness>): Promise<void> {
  await waitUntil(() => !fixture.componentInstance.refreshing(), 'the refresh in flight to settle');
  fixture.detectChanges();
}

/** Uses the single "Jetzt aktualisieren" control. Renders first, so the button's
 * `[disabled]="refreshing()"` state is current before the click. */
async function clickRefresh(fixture: ComponentFixture<OfflineReadiness>): Promise<void> {
  await whenIdle(fixture);
  const button = fixture.nativeElement.querySelector(
    '.offline-readiness__refresh',
  ) as HTMLButtonElement;
  expect(button.disabled).withContext('"Jetzt aktualisieren" is usable').toBeFalse();
  button.click();
  fixture.detectChanges();
}

/** Flushes the pending bundle GET and waits for the resulting IndexedDB
 * write + signal update to settle. */
async function flushBundleRequest(
  fixture: ComponentFixture<OfflineReadiness>,
  httpMock: HttpTestingController,
  bundle: OfflineBundle = BUNDLE,
): Promise<void> {
  const req = httpMock.expectOne((r) => r.method === 'GET' && r.url.endsWith('/offline-bundle/'));
  req.flush(bundle);
  await whenIdle(fixture);
}

describe('OfflineReadiness', () => {
  afterEach(async () => {
    // Real browser IndexedDB, not reset between TestBed environments — clear
    // it explicitly so a bundle cached by one test never leaks into the next.
    await TestBed.inject(ReferenceBundleCacheService).clear();
  });

  it('triggers a refresh on its own as soon as it is shown (no user action)', async () => {
    const {httpMock} = await setup();

    const req = httpMock.expectOne((r) => r.url.endsWith('/offline-bundle/'));
    expect(req.request.method).toBe('GET');
  });

  it('shows a not-ready state before the first refresh has completed', async () => {
    const {fixture} = await setup();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).not.toContain('zuletzt aktualisiert');
    expect(fixture.componentInstance.isReady()).toBeFalse();
  });

  it('shows the ready state and the last-refresh time once the bundle arrives', async () => {
    const {fixture, httpMock} = await setup();

    await flushBundleRequest(fixture, httpMock);

    expect(fixture.componentInstance.isReady()).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('zuletzt aktualisiert');
  });

  it('offers a "Jetzt aktualisieren" action that re-fetches the bundle', async () => {
    const {fixture, httpMock} = await setup();
    await flushBundleRequest(fixture, httpMock);

    const button = fixture.nativeElement.querySelector(
      '.offline-readiness__refresh',
    ) as HTMLButtonElement;
    expect(button).withContext('manual refresh action').not.toBeNull();

    button.click();
    fixture.detectChanges();

    const req = httpMock.expectOne((r) => r.url.endsWith('/offline-bundle/'));
    expect(req.request.method).toBe('GET');
    req.flush(BUNDLE);
    await settle();
  });

  it('keeps showing the ready state when a refresh fails offline (graceful degradation)', async () => {
    const {fixture, httpMock} = await setup();
    await flushBundleRequest(fixture, httpMock);
    expect(fixture.componentInstance.isReady()).toBeTrue();

    const button = fixture.nativeElement.querySelector(
      '.offline-readiness__refresh',
    ) as HTMLButtonElement;
    button.click();
    fixture.detectChanges();

    const req = httpMock.expectOne((r) => r.url.endsWith('/offline-bundle/'));
    expect(() => req.error(new ProgressEvent('error'))).not.toThrow();
    await settle();
    fixture.detectChanges();

    expect(fixture.componentInstance.isReady()).toBeTrue();
  });

  it('refreshes automatically when connectivity returns (window "online" event)', async () => {
    const {fixture, httpMock} = await setup();
    await flushBundleRequest(fixture, httpMock);

    window.dispatchEvent(new Event('online'));

    const req = httpMock.expectOne((r) => r.url.endsWith('/offline-bundle/'));
    expect(req.request.method).toBe('GET');
    req.flush(BUNDLE);
    await settle();
  });

  // Issue #407 / ADR 0032: running the current Version is the fourth clause of
  // Offline-Bereitschaft. A stale Version means *not* offline bereit, however
  // fresh the cache — and the indicator has to say which reason it is not ready,
  // or it becomes a light that means "something".
  describe('the Version clause (issue #407, ADR 0032)', () => {
    it('is not offline bereit while a newer Version waits, however fresh the cache', async () => {
      const {fixture, httpMock, swUpdate} = await setup();
      await flushBundleRequest(fixture, httpMock);
      expect(fixture.componentInstance.isReady())
        .withContext('a fresh cache alone used to be enough')
        .toBeTrue();

      emitVersionReady(swUpdate);
      fixture.detectChanges();

      expect(fixture.componentInstance.isReady()).toBeFalse();
      expect(fixture.nativeElement.textContent).toContain('Version veraltet');
      expect(fixture.nativeElement.textContent).not.toContain('Offline bereit');
    });

    it('names the beschädigter Cache as its own distinct reason on an unrecoverable service worker', async () => {
      const {fixture, httpMock, swUpdate} = await setup();
      await flushBundleRequest(fixture, httpMock);

      swUpdate.unrecoverable.next({
        type: 'UNRECOVERABLE_STATE',
        reason: 'cached files are missing',
      });
      fixture.detectChanges();

      expect(fixture.componentInstance.isReady()).toBeFalse();
      expect(fixture.nativeElement.textContent).toContain('App-Cache beschädigt');
      expect(fixture.nativeElement.textContent)
        .withContext('a broken cache is not the same reason as a stale Version')
        .not.toContain('Version veraltet');
    });

    // ADR 0032 decision 5 / ADR 0033 decision 5: a 404 on replay is better
    // evidence of staleness than ngsw's own check. Issue #409 calls this seam.
    it('reports a stale Version when the server observes the drift', async () => {
      const {fixture, httpMock} = await setup();
      await flushBundleRequest(fixture, httpMock);

      TestBed.inject(AppUpdateService).markVersionStale();
      fixture.detectChanges();

      expect(fixture.componentInstance.isReady()).toBeFalse();
      expect(fixture.nativeElement.textContent).toContain('Version veraltet');
    });

    it('keeps showing the cache reason while the cache is still being prepared', async () => {
      const {fixture} = await setup();

      expect(fixture.nativeElement.textContent).toContain('Cache wird vorbereitet');
      expect(fixture.nativeElement.textContent).not.toContain('Version veraltet');
    });

    it('adopts a waiting Version when "Jetzt aktualisieren" is used', async () => {
      const {fixture, httpMock, swUpdate, reload} = await setup();
      await flushBundleRequest(fixture, httpMock);
      emitVersionReady(swUpdate);
      fixture.detectChanges();

      await clickRefresh(fixture);
      httpMock.expectOne((r) => r.url.endsWith('/offline-bundle/')).flush(BUNDLE);
      await settle();

      expect(swUpdate.activateUpdate).toHaveBeenCalled();
      expect(reload).withContext('adoption is activateUpdate + reload').toHaveBeenCalled();
    });

    // ADR 0032 decision 2: nothing is ever force-reloaded. No timer, no nag, no
    // auto-reload — the indicator surfaces, the Beringer decides.
    it('never adopts a waiting Version on its own, without the user action', async () => {
      const {fixture, httpMock, swUpdate, reload} = await setup();
      await flushBundleRequest(fixture, httpMock);

      emitVersionReady(swUpdate);
      fixture.detectChanges();
      await settle();

      expect(swUpdate.activateUpdate).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
    });

    it('never reloads on its own on an unrecoverable service worker (offline it would not come back)', async () => {
      const {fixture, httpMock, swUpdate, reload} = await setup();
      await flushBundleRequest(fixture, httpMock);

      swUpdate.unrecoverable.next({type: 'UNRECOVERABLE_STATE', reason: 'broken'});
      fixture.detectChanges();
      await settle();

      expect(reload).not.toHaveBeenCalled();
    });

    it('offers the recovery reload only while online', async () => {
      const {fixture, httpMock, swUpdate, reload} = await setup();
      await flushBundleRequest(fixture, httpMock);
      swUpdate.unrecoverable.next({type: 'UNRECOVERABLE_STATE', reason: 'broken'});
      fixture.detectChanges();

      TestBed.inject(ConnectivityService).markOffline();
      await clickRefresh(fixture);
      httpMock.expectOne((r) => r.url.endsWith('/offline-bundle/')).flush(BUNDLE);
      await settle();
      expect(reload)
        .withContext('offline, a reload would seal the queued captures behind a dead app')
        .not.toHaveBeenCalled();

      TestBed.inject(ConnectivityService).markOnline();
      await clickRefresh(fixture);
      httpMock.expectOne((r) => r.url.endsWith('/offline-bundle/')).flush(BUNDLE);
      await settle();
      expect(reload).toHaveBeenCalled();
    });

    // ADR 0032 decision 3: the established `onReset` idiom (#24) — a pristine
    // form adopts immediately, a dirty one is asked about first.
    it('adopts without a question when no capture is in progress', async () => {
      const {fixture, httpMock, swUpdate, dialog} = await setup();
      await flushBundleRequest(fixture, httpMock);
      emitVersionReady(swUpdate);
      fixture.detectChanges();

      await clickRefresh(fixture);
      httpMock.expectOne((r) => r.url.endsWith('/offline-bundle/')).flush(BUNDLE);
      await settle();

      expect(dialog.open).not.toHaveBeenCalled();
      expect(swUpdate.activateUpdate).toHaveBeenCalled();
    });

    it('leaves the Version waiting when the Beringer declines mid-capture', async () => {
      const {fixture, httpMock, swUpdate, reload, dialog} = await setup();
      await flushBundleRequest(fixture, httpMock);
      TestBed.inject(UnsavedChangesService).watch(() => true);
      dialog.open.and.returnValue({afterClosed: () => of(false)});
      emitVersionReady(swUpdate);
      fixture.detectChanges();

      await clickRefresh(fixture);
      httpMock.expectOne((r) => r.url.endsWith('/offline-bundle/')).flush(BUNDLE);
      await settle();
      fixture.detectChanges();

      expect(dialog.open).toHaveBeenCalled();
      expect(swUpdate.activateUpdate).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
      expect(fixture.nativeElement.textContent)
        .withContext('a declined Version simply keeps waiting')
        .toContain('Version veraltet');
    });

    // ADR 0032 decision 1: the two jobs of "Jetzt aktualisieren" separate in one
    // direction only — declining a Version must never cost the Beringer his cache
    // refresh, so the top-up is unconditional.
    it('runs the reference-cache top-up even when the Version is declined', async () => {
      const {fixture, httpMock, swUpdate, dialog} = await setup();
      await flushBundleRequest(fixture, httpMock);
      TestBed.inject(UnsavedChangesService).watch(() => true);
      dialog.open.and.returnValue({afterClosed: () => of(false)});
      emitVersionReady(swUpdate);
      fixture.detectChanges();

      await clickRefresh(fixture);

      const req = httpMock.expectOne((r) => r.url.endsWith('/offline-bundle/'));
      expect(req.request.method)
        .withContext('the cache top-up runs unconditionally')
        .toBe('GET');
      req.flush(BUNDLE);
      await settle();

      expect(swUpdate.activateUpdate).not.toHaveBeenCalled();
    });

    // User Stories 1/2/3: the device the ADR was written for is the tab that has
    // been open since Tuesday. ngsw only checks for updates on registration and
    // on `navigate` requests — this SPA issues none after boot — so unless the
    // indicator asks, a Wednesday deploy is never discovered and the green
    // "Offline bereit" stands indefinitely. Asking is neither a nag, nor an
    // auto-activateUpdate, nor a reload, so ADR 0032 decision 2 permits it.
    // These need no warm cache: a stale Version outranks a cache still warming
    // up, so the headline is the Version's either way. Left un-flushed on
    // purpose — the reference-cache round trip writes through to real IndexedDB,
    // and this file's timing budget is the suite's tightest.
    describe('discovering a new Version on a long-lived tab', () => {
      it('flips to "Version veraltet" on its own, with no user action, when a deploy lands', async () => {
        const {fixture} = await setup({swUpdate: swUpdateThatFindsAVersion()});
        await settle();
        fixture.detectChanges();

        expect(fixture.nativeElement.textContent)
          .withContext('a deploy the tab has never navigated to must still surface')
          .toContain('Version veraltet');
        expect(fixture.componentInstance.isReady()).toBeFalse();
      });

      it('looks for a new Version again when connectivity returns', async () => {
        const swUpdate = new FakeSwUpdate();
        await setup({swUpdate});
        swUpdate.checkForUpdate.calls.reset();

        window.dispatchEvent(new Event('online'));

        expect(swUpdate.checkForUpdate)
          .withContext('back on the net is exactly when a deploy can be found')
          .toHaveBeenCalled();
      });

      // The check is a *look*, never an adoption: ADR 0032 decision 2 forbids
      // any reload the Beringer did not ask for.
      it('never adopts what it discovers on its own', async () => {
        const {swUpdate, reload} = await setup({swUpdate: swUpdateThatFindsAVersion()});
        await settle();

        expect(swUpdate.activateUpdate).not.toHaveBeenCalled();
        expect(reload).not.toHaveBeenCalled();
      });
    });

    // ADR 0032 decision 5: the server may flip the indicator (#409's 404 path).
    // That is a fact about *this* bundle, not a Version ngsw is holding — there
    // is nothing to activate, so there is nothing a reload could achieve.
    describe('a drift only the server has seen', () => {
      it('does not reload when there is no Version to activate', async () => {
        const {fixture, httpMock, swUpdate, reload} = await setup();
        await flushBundleRequest(fixture, httpMock);
        TestBed.inject(AppUpdateService).markVersionStale();
        fixture.detectChanges();

        await clickRefresh(fixture);
        httpMock.expectOne((r) => r.url.endsWith('/offline-bundle/')).flush(BUNDLE);
        await settle();
        fixture.detectChanges();

        expect(swUpdate.activateUpdate).not.toHaveBeenCalled();
        expect(reload)
          .withContext('the tab would come back on the very same bundle')
          .not.toHaveBeenCalled();
        expect(fixture.nativeElement.textContent)
          .withContext('a reload would destroy the drift and re-render a false green')
          .toContain('Version veraltet');
        expect(fixture.nativeElement.textContent).not.toContain('Offline bereit');
      });

      it('never asks the Beringer to discard his capture when there is nothing to adopt', async () => {
        const {fixture, httpMock, dialog} = await setup();
        await flushBundleRequest(fixture, httpMock);
        TestBed.inject(UnsavedChangesService).watch(() => true);
        TestBed.inject(AppUpdateService).markVersionStale();
        fixture.detectChanges();

        await clickRefresh(fixture);
        httpMock.expectOne((r) => r.url.endsWith('/offline-bundle/')).flush(BUNDLE);
        await settle();

        expect(dialog.open)
          .withContext('no question whose "yes" would do nothing at all')
          .not.toHaveBeenCalled();
      });

      // The happy path the hint promises: the click asks ngsw to look, ngsw
      // finds the Version the server was talking about, and *that* adopts.
      it('adopts the Version the click discovers', async () => {
        const {fixture, httpMock, swUpdate, reload} = await setup({
          swUpdate: swUpdateThatFindsAVersion(),
        });
        await flushBundleRequest(fixture, httpMock);
        TestBed.inject(AppUpdateService).markVersionStale();
        fixture.detectChanges();

        await clickRefresh(fixture);
        httpMock.expectOne((r) => r.url.endsWith('/offline-bundle/')).flush(BUNDLE);
        await settle();

        expect(swUpdate.activateUpdate).toHaveBeenCalled();
        expect(reload).toHaveBeenCalled();
      });
    });
  });

  describe('persistent storage state (issue #166)', () => {
    it('shows no persistence icon while the browser request is still pending', async () => {
      const {fixture} = await setup({persist: 'pending'});

      const icon = fixture.nativeElement.querySelector('.offline-readiness__persistence');
      expect(icon).withContext('no persistence icon before the request settles').toBeNull();
    });

    it('shows a protected-storage icon once persistent storage is granted', async () => {
      const {fixture} = await setup({persist: true});
      await settle();
      fixture.detectChanges();

      const icon = fixture.nativeElement.querySelector('.offline-readiness__persistence--granted');
      expect(icon).withContext('granted persistence icon').not.toBeNull();
      expect(fixture.nativeElement.querySelector('.offline-readiness__persistence--denied')).toBeNull();
    });

    it('shows a denied-persistence icon when the browser refuses persistent storage', async () => {
      const {fixture} = await setup({persist: false});
      await settle();
      fixture.detectChanges();

      const icon = fixture.nativeElement.querySelector('.offline-readiness__persistence--denied');
      expect(icon).withContext('denied persistence icon').not.toBeNull();
      expect(
        fixture.nativeElement.querySelector('.offline-readiness__persistence--granted'),
      ).toBeNull();
    });
  });
});
