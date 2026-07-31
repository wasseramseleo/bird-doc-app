import {TestBed} from '@angular/core/testing';
import {HttpClient, HttpContext, provideHttpClient, withInterceptors} from '@angular/common/http';
import {HttpTestingController, provideHttpClientTesting} from '@angular/common/http/testing';
import {provideRouter, Router} from '@angular/router';
import {firstValueFrom} from 'rxjs';

import {authInterceptor} from './auth.interceptor';
import {sessionExpiryAtTheGesture} from '../errors/session-expiry';
import {durableWrite} from '../offline/durable-write';
import {AuthService} from '../../service/auth.service';
import {IdentityCacheService} from '../offline/identity-cache';
import {ReferenceBundleCacheService} from '../offline/reference-bundle-cache';

const REFERENCE_BUNDLE = {
  identity: {username: 'fre', handle: 'FRE', organization: null, rolle: 'mitglied' as const},
  species: [],
  ringing_stations: [],
  scientists: [],
  projects: [],
  centrals: [],
  last_consumed_ring_numbers: [],
};

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let authService: AuthService;
  let identityCache: IdentityCacheService;
  let referenceBundleCache: ReferenceBundleCacheService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([{path: 'login', children: []}]),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    authService = TestBed.inject(AuthService);
    identityCache = TestBed.inject(IdentityCacheService);
    referenceBundleCache = TestBed.inject(ReferenceBundleCacheService);
  });

  afterEach(async () => {
    httpMock.verify();
    await identityCache.clear();
    await referenceBundleCache.clear();
  });

  // PRD #152 prod regression: with the Angular service worker (ngsw) active in
  // production, an offline `/api` request is intercepted by the SW and returned
  // as a synthetic HTTP 504 ("Gateway Timeout") instead of failing as a real
  // network error. The whole offline architecture (DataAccessFacadeService's
  // outbox/cache fallback, AuthService.bootstrap) keys off `status === 0`, so a
  // 504 slips past every offline check — captures error out instead of queueing.
  // Tagging every request with `ngsw-bypass` makes the SW ignore API traffic, so
  // an offline failure surfaces as `status === 0` in prod exactly as in dev.
  it('adds the ngsw-bypass header to every request so the service worker never intercepts API traffic', () => {
    http.get('/api/birds/species/').subscribe({next: () => undefined, error: () => undefined});
    const getReq = httpMock.expectOne('/api/birds/species/');
    expect(getReq.request.headers.get('ngsw-bypass')).toBe('true');
    getReq.flush({});

    http.post('/api/birds/data-entries/', {}).subscribe({next: () => undefined, error: () => undefined});
    const postReq = httpMock.expectOne('/api/birds/data-entries/');
    expect(postReq.request.headers.get('ngsw-bypass')).toBe('true');
    postReq.flush({});
  });

  it('clears the cached identity and reference-bundle cache when a non-auth request comes back 401 (session expired)', async () => {
    await identityCache.save({
      username: 'fre',
      handle: 'FRE',
      isStaff: false,
      rolle: 'mitglied',
      organization: null,
    });
    await referenceBundleCache.save({bundle: REFERENCE_BUNDLE, refreshedAt: '2026-06-01T09:00:00.000Z'});
    authService.currentUser.set({
      username: 'fre',
      handle: 'FRE',
      isStaff: false,
      rolle: 'mitglied',
      organization: null,
    });

    http.get('/api/birds/data-entries/').subscribe({error: () => undefined});
    const req = httpMock.expectOne('/api/birds/data-entries/');
    req.flush({detail: 'Not authenticated.'}, {status: 401, statusText: 'Unauthorized'});
    // Let the interceptor's cache-clearing microtask settle.
    await Promise.resolve();
    await Promise.resolve();

    expect(authService.currentUser()).toBeNull();
    expect(await identityCache.load()).toBeNull();
    expect(await referenceBundleCache.load()).toBeNull();
  });

  // #447 (ADR 0037/0039): ein Sitzungsablauf vernichtete bislang einen Fang, den
  // ein Netzausfall bewahrt hätte — weil die Aufforderung zur erneuten Anmeldung
  // *vor* der Rettung kam. Meldet der Schreibvorgang seinen Fehlschlag selbst,
  // an der Geste, wartet sie: der Fang geht zuerst in die Outbox, und die reiht
  // unter dem angemeldeten Konto ein (Mandantengrenze aus #160), das hier
  // deshalb noch stehen muss.
  describe('ein Schreibvorgang, der seinen 401 selbst meldet (#447, ADR 0037)', () => {
    beforeEach(async () => {
      await identityCache.save({
        username: 'fre',
        handle: 'FRE',
        isStaff: false,
        rolle: 'mitglied',
        organization: null,
      });
      authService.currentUser.set({
        username: 'fre',
        handle: 'FRE',
        isStaff: false,
        rolle: 'mitglied',
        organization: null,
      });
    });

    async function post401(context?: HttpContext): Promise<void> {
      http
        .post('/api/birds/data-entries/', {}, context ? {context} : {})
        .subscribe({error: () => undefined});
      httpMock
        .expectOne('/api/birds/data-entries/')
        .flush({detail: 'Anmeldedaten fehlen.'}, {status: 401, statusText: 'Unauthorized'});
      // Let the interceptor's cache-clearing microtask settle.
      await Promise.resolve();
      await Promise.resolve();
    }

    it('hält bei einem 401 die Abmeldung und den Sprung zur Anmeldung zurück', async () => {
      const navigate = spyOn(TestBed.inject(Router), 'navigate');

      await post401(durableWrite());

      expect(navigate).not.toHaveBeenCalled();
      expect(authService.currentUser()).not.toBeNull();
    });

    // Die Markierung ist **nicht** dieselbe wie die Dauerhaftigkeit: der
    // Fang-Edit trägt sie allein, ohne je eingereiht zu werden. Seine Korrektur
    // steht im Formular und sonst nirgends, also darf der globale Sprung sie
    // nicht mitnehmen — was er täte, denn die Navigation weckt den
    // `unsavedChangesGuard` (#407) über genau dieser Korrektur. Was das am
    // Formular bedeutet, prüft `data-entry-form.spec.ts` an der ganzen Kette.
    it('hält es auch ohne Dauerhaftigkeit zurück — der Fang-Edit trägt die Markierung allein', async () => {
      const navigate = spyOn(TestBed.inject(Router), 'navigate');
      await referenceBundleCache.save({
        bundle: REFERENCE_BUNDLE,
        refreshedAt: '2026-06-01T09:00:00.000Z',
      });

      await post401(sessionExpiryAtTheGesture());

      expect(navigate).not.toHaveBeenCalled();
      expect(authService.currentUser()).not.toBeNull();
      expect(await referenceBundleCache.load()).not.toBeNull();
      // Und der Zwischenspeicher der Identität geht trotzdem — auf dem geteilten
      // Tablet gilt das für jeden 401, egal wer ihn meldet.
      expect(await identityCache.load()).toBeNull();
    });

    // #158: bis das Mitglied „Anmelden" drückt, erfasst es weiter — und dazu
    // gehört das zwischengespeicherte Referenz-Bündel, aus dem die Arten, die
    // Stationen und die Beringer offline kommen. Es wegzuräumen, während die
    // Erfassung noch läuft, hieße genau das zu nehmen, wofür der 401
    // zurückgehalten wird. `AuthService.sessionExpired()` am Knopf holt es nach.
    it('lässt das Referenz-Bündel stehen, aus dem das Mitglied weiter erfasst', async () => {
      await referenceBundleCache.save({
        bundle: REFERENCE_BUNDLE,
        refreshedAt: '2026-06-01T09:00:00.000Z',
      });

      await post401(durableWrite());

      expect(await referenceBundleCache.load()).not.toBeNull();
    });

    // Der Zwischenspeicher der Identität ist die eine Sache, die **nicht**
    // wartet (#156/#158). Das Mitglied bringt die Runde zu Ende und klappt den
    // Deckel des geteilten Tablets zu, ohne je „Anmelden" gedrückt zu haben;
    // läge die Identität dann noch da, meldete `bootstrap()` beim nächsten
    // Kaltstart ohne Empfang den Vorigen wieder an — und der Nächste an der
    // Station stünde in dessen Konto, sähe dessen Warteschlange und erfasste
    // unter dessen `accountKey`. Die Rettung braucht ihn nicht: die Outbox
    // reiht unter `currentUser()` ein, dem Signal im Speicher.
    it('leert trotzdem die zwischengespeicherte Identität — das geteilte Tablet darf sie nicht überdauern', async () => {
      await post401(durableWrite());

      expect(await identityCache.load()).toBeNull();
      // Und die Rettung steht: das angemeldete Konto ist noch da, unter dem die
      // Outbox einreiht.
      expect(authService.currentUser()).not.toBeNull();
    });

    it('meldet den Nächsten am geteilten Tablet nicht als den Vorigen an', async () => {
      await post401(durableWrite());
      // Der Deckel fällt zu, das Tablet startet ohne Empfang neu.
      authService.currentUser.set(null);

      const booted = firstValueFrom(authService.bootstrap());
      httpMock
        .expectOne((r) => r.url.endsWith('/auth/me/'))
        .error(new ProgressEvent('error'), {status: 0, statusText: 'Unknown Error'});

      expect(await booted).toBeNull();
      expect(authService.currentUser()).toBeNull();
    });

    it('tut bei einem gewöhnlichen Schreibvorgang unverändert beides', async () => {
      const navigate = spyOn(TestBed.inject(Router), 'navigate');
      await referenceBundleCache.save({
        bundle: REFERENCE_BUNDLE,
        refreshedAt: '2026-06-01T09:00:00.000Z',
      });

      await post401();

      expect(navigate).toHaveBeenCalledWith(['/login'], jasmine.anything());
      expect(authService.currentUser()).toBeNull();
      expect(await identityCache.load()).toBeNull();
      expect(await referenceBundleCache.load()).toBeNull();
    });
  });
});
