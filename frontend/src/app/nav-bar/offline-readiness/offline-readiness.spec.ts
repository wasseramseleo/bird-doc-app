import {ComponentFixture, TestBed} from '@angular/core/testing';
import {provideHttpClient} from '@angular/common/http';
import {HttpTestingController, provideHttpClientTesting} from '@angular/common/http/testing';

import {OfflineReadiness} from './offline-readiness';
import {ReferenceBundleCacheService} from '../../core/offline/reference-bundle-cache';
import {OfflineBundle} from '../../models/offline-bundle.model';

const BUNDLE: OfflineBundle = {
  identity: {username: 'fre', handle: 'FRE', organization: null, rolle: 'mitglied'},
  species: [],
  ringing_stations: [],
  scientists: [],
  projects: [],
  centrals: [],
  last_consumed_ring_numbers: [],
};

async function setup(
  options: {persist?: boolean | 'pending'} = {},
): Promise<{
  fixture: ComponentFixture<OfflineReadiness>;
  httpMock: HttpTestingController;
}> {
  const {persist = true} = options;
  if (persist === 'pending') {
    spyOn(navigator.storage, 'persist').and.returnValue(new Promise(() => {}));
  } else {
    spyOn(navigator.storage, 'persist').and.resolveTo(persist);
  }

  TestBed.configureTestingModule({
    imports: [OfflineReadiness],
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  const fixture = TestBed.createComponent(OfflineReadiness);
  const httpMock = TestBed.inject(HttpTestingController);
  fixture.detectChanges();
  return {fixture, httpMock};
}

/** The refresh chain writes through to the real (unpatched by Zone) browser
 * IndexedDB, so neither `fixture.whenStable()` nor a plain microtask await
 * observes its completion — only real elapsed time does. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
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
  await settle();
  fixture.detectChanges();
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
