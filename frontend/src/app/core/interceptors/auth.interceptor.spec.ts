import {TestBed} from '@angular/core/testing';
import {HttpClient, provideHttpClient, withInterceptors} from '@angular/common/http';
import {HttpTestingController, provideHttpClientTesting} from '@angular/common/http/testing';
import {provideRouter} from '@angular/router';

import {authInterceptor} from './auth.interceptor';
import {AuthService} from '../../service/auth.service';
import {IdentityCacheService} from '../offline/identity-cache';

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let authService: AuthService;
  let identityCache: IdentityCacheService;

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
  });

  afterEach(async () => {
    httpMock.verify();
    await identityCache.clear();
  });

  it('clears the cached identity when a non-auth request comes back 401 (session expired)', async () => {
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

    http.get('/api/birds/data-entries/').subscribe({error: () => undefined});
    const req = httpMock.expectOne('/api/birds/data-entries/');
    req.flush({detail: 'Not authenticated.'}, {status: 401, statusText: 'Unauthorized'});
    // Let the interceptor's cache-clearing microtask settle.
    await Promise.resolve();
    await Promise.resolve();

    expect(authService.currentUser()).toBeNull();
    expect(await identityCache.load()).toBeNull();
  });
});
