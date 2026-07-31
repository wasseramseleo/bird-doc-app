import {TestBed} from '@angular/core/testing';
import {
  HttpClient,
  HttpErrorResponse,
  HttpInterceptorFn,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import {HttpTestingController, provideHttpClientTesting} from '@angular/common/http/testing';
import {provideRouter, Router} from '@angular/router';
import {throwError} from 'rxjs';

import {failureInterceptor} from './failure.interceptor';
import {authInterceptor} from './auth.interceptor';
import {HTTP_INTERCEPTORS_IN_ORDER} from '../../app.config';
import {appFailureOf, Fehlerklasse} from '../errors/app-failure';
import {AuthService} from '../../service/auth.service';
import {IdentityCacheService} from '../offline/identity-cache';
import {ReferenceBundleCacheService} from '../offline/reference-bundle-cache';

const RING_ALREADY_FIRST_CAUGHT =
  'Für diese Ringnummer besteht in dieser Organisation bereits ein Erstfang.';

/** Ein innerer Interceptor, der aus eigenem Antrieb scheitert. */
const throwingInterceptor: HttpInterceptorFn = () =>
  throwError(
    () =>
      new HttpErrorResponse({
        status: 503,
        statusText: 'Service Unavailable',
        url: '/api/birds/data-entries/',
        error: {detail: 'Wartung'},
      }),
  );

describe('failureInterceptor', () => {
  function setup(interceptors: HttpInterceptorFn[]): {
    http: HttpClient;
    httpMock: HttpTestingController;
  } {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors(interceptors)),
        provideHttpClientTesting(),
        provideRouter([{path: 'login', children: []}]),
      ],
    });
    return {http: TestBed.inject(HttpClient), httpMock: TestBed.inject(HttpTestingController)};
  }

  it('reicht die Einordnung an den Aufrufer weiter, ohne den Fehler zu ersetzen', () => {
    const {http, httpMock} = setup([failureInterceptor]);
    let caught: unknown;

    http.post('/api/birds/data-entries/', {}).subscribe({error: (error: unknown) => (caught = error)});
    httpMock.expectOne('/api/birds/data-entries/').flush(
      {
        ring_number: RING_ALREADY_FIRST_CAUGHT,
        errors: [{field: 'ring_number', code: 'invalid', detail: RING_ALREADY_FIRST_CAUGHT}],
      },
      {status: 400, statusText: 'Bad Request'},
    );

    // Additiv, nicht zerstörend: der Ursprungsfehler ist derselbe geblieben …
    expect(caught instanceof HttpErrorResponse).toBe(true);
    expect((caught as HttpErrorResponse).status).toBe(400);
    // … und trägt die Einordnung mit sich.
    const failure = appFailureOf(caught);
    expect(failure.klasse).toBe(Fehlerklasse.Korrigieren);
    expect(failure.text).toBe(RING_ALREADY_FIRST_CAUGHT);
    expect(failure.field).toBe('ring_number');
    httpMock.verify();
  });

  it('lässt den Verbindungsabbruch als `status === 0` durch — die Offline-Fassade verzweigt darauf', () => {
    const {http, httpMock} = setup([failureInterceptor]);
    let caught: unknown;

    http.post('/api/birds/data-entries/', {}).subscribe({error: (error: unknown) => (caught = error)});
    httpMock
      .expectOne('/api/birds/data-entries/')
      .error(new ProgressEvent('error'), {status: 0, statusText: 'Unknown Error'});

    expect(caught instanceof HttpErrorResponse).toBe(true);
    expect((caught as HttpErrorResponse).status).toBe(0);
    expect(appFailureOf(caught).klasse).toBe(Fehlerklasse.ErneutVersuchen);
    httpMock.verify();
  });

  it('lässt den `Retry-After`-Header stehen — der Sync liest ihn', () => {
    const {http, httpMock} = setup([failureInterceptor]);
    let caught: unknown;

    http.post('/api/birds/data-entries/', {}).subscribe({error: (error: unknown) => (caught = error)});
    httpMock
      .expectOne('/api/birds/data-entries/')
      .flush({detail: 'zu viele Anfragen'}, {
        status: 429,
        statusText: 'Too Many Requests',
        headers: {'Retry-After': '120'},
      });

    expect((caught as HttpErrorResponse).headers.get('Retry-After')).toBe('120');
    httpMock.verify();
  });

  it('ordnet auch einen Fehler ein, den ein innerer Interceptor selbst wirft', () => {
    // Der Grund, äußerster zu sein: was unter ihm entsteht, kommt trotzdem
    // eingeordnet beim Aufrufer an.
    const {http, httpMock} = setup([failureInterceptor, throwingInterceptor]);
    let caught: unknown;

    http.post('/api/birds/data-entries/', {}).subscribe({error: (error: unknown) => (caught = error)});

    expect(appFailureOf(caught).klasse).toBe(Fehlerklasse.ErneutVersuchen);
    expect(appFailureOf(caught).text).toBe('Wartung');
    httpMock.verify();
  });

  it('ist in `app.config` als äußerster registriert', () => {
    // Die Reihenfolge ist Vertrag (ADR 0037): der `authInterceptor` muss den
    // rohen Fehler *unter* der Abbildung weiter sehen.
    expect(HTTP_INTERCEPTORS_IN_ORDER[0]).toBe(failureInterceptor);
    expect(HTTP_INTERCEPTORS_IN_ORDER).toContain(authInterceptor);
  });

  describe('unter dem authInterceptor, in der Reihenfolge von app.config', () => {
    it('lässt dessen 401-Arbeit unangetastet und reicht die Klasse trotzdem hoch', async () => {
      const {http, httpMock} = setup([failureInterceptor, authInterceptor]);
      const authService = TestBed.inject(AuthService);
      const identityCache = TestBed.inject(IdentityCacheService);
      const referenceBundleCache = TestBed.inject(ReferenceBundleCacheService);
      const router = TestBed.inject(Router);
      const navigate = spyOn(router, 'navigate');
      authService.currentUser.set({
        username: 'fre',
        handle: 'FRE',
        isStaff: false,
        rolle: 'mitglied',
        organization: null,
      });
      let caught: unknown;

      http.get('/api/birds/data-entries/').subscribe({error: (error: unknown) => (caught = error)});
      httpMock
        .expectOne('/api/birds/data-entries/')
        .flush({detail: 'Anmeldedaten fehlen.'}, {status: 401, statusText: 'Unauthorized'});
      await Promise.resolve();
      await Promise.resolve();

      // Der authInterceptor hat den rohen Fehler gesehen und seine Arbeit getan.
      expect(authService.currentUser()).toBeNull();
      expect(navigate).toHaveBeenCalledWith(['/login'], jasmine.anything());
      // Und der Aufrufer bekommt die Klasse, nicht den Status.
      expect(appFailureOf(caught).klasse).toBe(Fehlerklasse.NeuAnmelden);

      httpMock.verify();
      await identityCache.clear();
      await referenceBundleCache.clear();
    });
  });
});
