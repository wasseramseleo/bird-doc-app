import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';

import { AuthService } from './auth.service';
import { IdentityCacheService } from '../core/offline/identity-cache';
import { ReferenceBundleCacheService } from '../core/offline/reference-bundle-cache';

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;
  let identityCache: IdentityCacheService;
  let referenceBundleCache: ReferenceBundleCacheService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
    identityCache = TestBed.inject(IdentityCacheService);
    referenceBundleCache = TestBed.inject(ReferenceBundleCacheService);
  });

  afterEach(async () => {
    httpMock.verify();
    await identityCache.clear();
    await referenceBundleCache.clear();
  });

  it('exposes the active-organization Rolle and Organisation from the login payload', async () => {
    const resultPromise = firstValueFrom(service.login('admin@example.com', 'pw'));

    const req = httpMock.expectOne((r) => r.method === 'POST' && r.url.endsWith('/auth/login/'));
    req.flush({
      username: 'admin@example.com',
      handle: 'ADM',
      is_staff: false,
      active_organization_rolle: 'admin',
      active_organization: {id: 'o1', handle: 'IWM', name: 'IWM Linz', country: 'AT'},
    });
    await resultPromise;

    expect(service.currentUser()?.rolle).toBe('admin');
    expect(service.currentUser()?.organization).toEqual({
      id: 'o1',
      handle: 'IWM',
      name: 'IWM Linz',
      country: 'AT',
    });
  });

  it('reports a null Rolle and Organisation when /me has no unambiguous active Organisation', async () => {
    const resultPromise = firstValueFrom(service.bootstrap());

    const req = httpMock.expectOne((r) => r.method === 'GET' && r.url.endsWith('/auth/me/'));
    req.flush({
      username: 'x',
      handle: null,
      is_staff: false,
      active_organization_rolle: null,
      active_organization: null,
    });
    await resultPromise;

    expect(service.currentUser()?.rolle).toBeNull();
    expect(service.currentUser()?.organization).toBeNull();
  });

  it('caches the identity in IndexedDB after a successful login', async () => {
    const resultPromise = firstValueFrom(service.login('admin@example.com', 'pw'));

    const req = httpMock.expectOne((r) => r.method === 'POST' && r.url.endsWith('/auth/login/'));
    req.flush({
      username: 'admin@example.com',
      handle: 'ADM',
      is_staff: false,
      active_organization_rolle: 'admin',
      active_organization: {id: 'o1', handle: 'IWM', name: 'IWM Linz', country: 'AT'},
    });
    await resultPromise;

    const cached = await identityCache.load();
    expect(cached?.username).toBe('admin@example.com');
  });

  it('caches the identity in IndexedDB after a successful session check', async () => {
    const resultPromise = firstValueFrom(service.bootstrap());

    const req = httpMock.expectOne((r) => r.method === 'GET' && r.url.endsWith('/auth/me/'));
    req.flush({
      username: 'fre',
      handle: 'FRE',
      is_staff: false,
      active_organization_rolle: 'mitglied',
      active_organization: {id: 'o1', handle: 'IWM', name: 'IWM Linz', country: 'AT'},
    });
    await resultPromise;

    const cached = await identityCache.load();
    expect(cached?.username).toBe('fre');
  });

  it('falls back to the cached identity when the session check fails for lack of connectivity', async () => {
    await identityCache.save({
      username: 'fre',
      handle: 'FRE',
      isStaff: false,
      rolle: 'mitglied',
      organization: {id: 'o1', handle: 'IWM', name: 'IWM Linz', country: 'AT'},
    });

    const resultPromise = firstValueFrom(service.bootstrap());
    const req = httpMock.expectOne((r) => r.method === 'GET' && r.url.endsWith('/auth/me/'));
    req.error(new ProgressEvent('error'));
    const result = await resultPromise;

    expect(result?.username).toBe('fre');
    expect(service.currentUser()?.username).toBe('fre');
  });

  it('does not fall back to a cached identity on a genuine 401 and clears the identity and reference-bundle caches', async () => {
    await identityCache.save({
      username: 'fre',
      handle: 'FRE',
      isStaff: false,
      rolle: 'mitglied',
      organization: {id: 'o1', handle: 'IWM', name: 'IWM Linz', country: 'AT'},
    });
    await referenceBundleCache.save({bundle: REFERENCE_BUNDLE, refreshedAt: '2026-06-01T09:00:00.000Z'});

    const resultPromise = firstValueFrom(service.bootstrap());
    const req = httpMock.expectOne((r) => r.method === 'GET' && r.url.endsWith('/auth/me/'));
    req.flush({detail: 'Not authenticated.'}, {status: 401, statusText: 'Unauthorized'});
    const result = await resultPromise;

    expect(result).toBeNull();
    expect(service.currentUser()).toBeNull();
    expect(await identityCache.load()).toBeNull();
    expect(await referenceBundleCache.load()).toBeNull();
  });

  it('clears the cached identity and reference bundle on logout', async () => {
    await identityCache.save({
      username: 'fre',
      handle: 'FRE',
      isStaff: false,
      rolle: 'mitglied',
      organization: null,
    });
    await referenceBundleCache.save({bundle: REFERENCE_BUNDLE, refreshedAt: '2026-06-01T09:00:00.000Z'});

    const resultPromise = firstValueFrom(service.logout());
    const req = httpMock.expectOne((r) => r.method === 'POST' && r.url.endsWith('/auth/logout/'));
    req.flush(null);
    await resultPromise;

    expect(await identityCache.load()).toBeNull();
    expect(await referenceBundleCache.load()).toBeNull();
  });

  it('clears currentUser and both caches on sessionExpired(), with no server round trip (issue #165)', async () => {
    service.currentUser.set({
      username: 'fre',
      handle: 'FRE',
      isStaff: false,
      rolle: 'mitglied',
      organization: null,
    });
    await identityCache.save({
      username: 'fre',
      handle: 'FRE',
      isStaff: false,
      rolle: 'mitglied',
      organization: null,
    });
    await referenceBundleCache.save({bundle: REFERENCE_BUNDLE, refreshedAt: '2026-06-01T09:00:00.000Z'});

    service.sessionExpired();
    // No logout POST — the session is already gone server-side; httpMock.verify()
    // in afterEach would fail on an unexpected request.
    await Promise.resolve();
    // Let the best-effort cache clears settle.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(service.currentUser()).toBeNull();
    expect(await identityCache.load()).toBeNull();
    expect(await referenceBundleCache.load()).toBeNull();
  });

  describe('refreshCsrfToken() (issue #161)', () => {
    it('hits GET /auth/me/ purely for its CSRF-cookie side effect, resolving to void', async () => {
      const resultPromise = firstValueFrom(service.refreshCsrfToken());

      const req = httpMock.expectOne((r) => r.method === 'GET' && r.url.endsWith('/auth/me/'));
      req.flush({
        username: 'fre',
        handle: 'FRE',
        is_staff: false,
        active_organization_rolle: 'mitglied',
        active_organization: null,
      });

      expect(await resultPromise).toBeUndefined();
    });

    it('does not change currentUser or cache the response', async () => {
      service.currentUser.set({
        username: 'someone-else',
        handle: 'ELS',
        isStaff: false,
        rolle: 'mitglied',
        organization: null,
      });

      const resultPromise = firstValueFrom(service.refreshCsrfToken());
      const req = httpMock.expectOne((r) => r.method === 'GET' && r.url.endsWith('/auth/me/'));
      req.flush({
        username: 'fre',
        handle: 'FRE',
        is_staff: false,
        active_organization_rolle: 'mitglied',
        active_organization: null,
      });
      await resultPromise;

      expect(service.currentUser()?.username).toBe('someone-else');
      expect(await identityCache.load()).toBeNull();
    });

    it('propagates a failure (e.g. no connectivity, or an expired session) to the caller unchanged', async () => {
      const resultPromise = firstValueFrom(service.refreshCsrfToken());
      const req = httpMock.expectOne((r) => r.method === 'GET' && r.url.endsWith('/auth/me/'));
      req.error(new ProgressEvent('error'));

      await expectAsync(resultPromise).toBeRejected();
    });
  });

  it('resolves login() with the user even when caching the identity fails', async () => {
    spyOn(identityCache, 'save').and.returnValue(Promise.reject(new Error('quota exceeded')));

    const resultPromise = firstValueFrom(service.login('admin@example.com', 'pw'));

    const req = httpMock.expectOne((r) => r.method === 'POST' && r.url.endsWith('/auth/login/'));
    req.flush({
      username: 'admin@example.com',
      handle: 'ADM',
      is_staff: false,
      active_organization_rolle: 'admin',
      active_organization: null,
    });
    const result = await resultPromise;

    expect(result.username).toBe('admin@example.com');
    expect(service.currentUser()?.username).toBe('admin@example.com');
  });

  it('resolves bootstrap() with the user even when caching the identity fails', async () => {
    spyOn(identityCache, 'save').and.returnValue(Promise.reject(new Error('quota exceeded')));

    const resultPromise = firstValueFrom(service.bootstrap());

    const req = httpMock.expectOne((r) => r.method === 'GET' && r.url.endsWith('/auth/me/'));
    req.flush({
      username: 'fre',
      handle: 'FRE',
      is_staff: false,
      active_organization_rolle: 'mitglied',
      active_organization: null,
    });
    const result = await resultPromise;

    expect(result?.username).toBe('fre');
    expect(service.currentUser()?.username).toBe('fre');
  });

  it('resolves bootstrap() to null instead of rejecting when reading the offline cache fails', async () => {
    spyOn(identityCache, 'load').and.returnValue(Promise.reject(new Error('IndexedDB blocked')));

    const resultPromise = firstValueFrom(service.bootstrap());
    const req = httpMock.expectOne((r) => r.method === 'GET' && r.url.endsWith('/auth/me/'));
    req.error(new ProgressEvent('error'));
    const result = await resultPromise;

    expect(result).toBeNull();
    expect(service.currentUser()).toBeNull();
  });

  it('still clears currentUser on a genuine 401 when clearing the cache fails', async () => {
    const clearSpy = spyOn(identityCache, 'clear').and.returnValue(
      Promise.reject(new Error('IndexedDB blocked')),
    );
    service.currentUser.set({
      username: 'fre',
      handle: 'FRE',
      isStaff: false,
      rolle: 'mitglied',
      organization: null,
    });

    const resultPromise = firstValueFrom(service.bootstrap());
    const req = httpMock.expectOne((r) => r.method === 'GET' && r.url.endsWith('/auth/me/'));
    req.flush({detail: 'Not authenticated.'}, {status: 401, statusText: 'Unauthorized'});
    const result = await resultPromise;

    expect(result).toBeNull();
    expect(service.currentUser()).toBeNull();

    clearSpy.and.callThrough();
  });

  it('still clears currentUser on logout when clearing the cache fails', async () => {
    const clearSpy = spyOn(identityCache, 'clear').and.returnValue(
      Promise.reject(new Error('IndexedDB blocked')),
    );
    service.currentUser.set({
      username: 'fre',
      handle: 'FRE',
      isStaff: false,
      rolle: 'mitglied',
      organization: null,
    });

    const resultPromise = firstValueFrom(service.logout());
    const req = httpMock.expectOne((r) => r.method === 'POST' && r.url.endsWith('/auth/logout/'));
    req.flush(null);
    await resultPromise;

    expect(service.currentUser()).toBeNull();

    clearSpy.and.callThrough();
  });

  it('still clears currentUser and the identity cache on a genuine 401 when clearing the reference-bundle cache fails', async () => {
    const clearSpy = spyOn(referenceBundleCache, 'clear').and.returnValue(
      Promise.reject(new Error('IndexedDB blocked')),
    );
    service.currentUser.set({
      username: 'fre',
      handle: 'FRE',
      isStaff: false,
      rolle: 'mitglied',
      organization: null,
    });
    await identityCache.save({
      username: 'fre',
      handle: 'FRE',
      isStaff: false,
      rolle: 'mitglied',
      organization: null,
    });

    const resultPromise = firstValueFrom(service.bootstrap());
    const req = httpMock.expectOne((r) => r.method === 'GET' && r.url.endsWith('/auth/me/'));
    req.flush({detail: 'Not authenticated.'}, {status: 401, statusText: 'Unauthorized'});
    const result = await resultPromise;

    expect(result).toBeNull();
    expect(service.currentUser()).toBeNull();
    expect(await identityCache.load()).toBeNull();

    clearSpy.and.callThrough();
  });

  it('still clears currentUser and the identity cache on logout when clearing the reference-bundle cache fails', async () => {
    const clearSpy = spyOn(referenceBundleCache, 'clear').and.returnValue(
      Promise.reject(new Error('IndexedDB blocked')),
    );
    service.currentUser.set({
      username: 'fre',
      handle: 'FRE',
      isStaff: false,
      rolle: 'mitglied',
      organization: null,
    });
    await identityCache.save({
      username: 'fre',
      handle: 'FRE',
      isStaff: false,
      rolle: 'mitglied',
      organization: null,
    });

    const resultPromise = firstValueFrom(service.logout());
    const req = httpMock.expectOne((r) => r.method === 'POST' && r.url.endsWith('/auth/logout/'));
    req.flush(null);
    await resultPromise;

    expect(service.currentUser()).toBeNull();
    expect(await identityCache.load()).toBeNull();

    clearSpy.and.callThrough();
  });
});

const REFERENCE_BUNDLE = {
  identity: {username: 'fre', handle: 'FRE', organization: null, rolle: 'mitglied' as const},
  species: [],
  ringing_stations: [],
  scientists: [],
  projects: [],
  last_consumed_ring_numbers: [],
};
