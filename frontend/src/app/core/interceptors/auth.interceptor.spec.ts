import {TestBed} from '@angular/core/testing';
import {HttpClient, provideHttpClient, withInterceptors} from '@angular/common/http';
import {HttpTestingController, provideHttpClientTesting} from '@angular/common/http/testing';
import {provideRouter} from '@angular/router';

import {authInterceptor} from './auth.interceptor';
import {AuthService} from '../../service/auth.service';
import {IdentityCacheService} from '../offline/identity-cache';
import {ReferenceBundleCacheService} from '../offline/reference-bundle-cache';

const REFERENCE_BUNDLE = {
  identity: {username: 'fre', handle: 'FRE', organization: null, rolle: 'mitglied' as const},
  species: [],
  ringing_stations: [],
  scientists: [],
  projects: [],
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
});
