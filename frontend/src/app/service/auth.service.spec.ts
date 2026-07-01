import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('exposes the active-organization Rolle from the login payload', () => {
    service.login('admin@example.com', 'pw').subscribe();

    const req = httpMock.expectOne((r) => r.method === 'POST' && r.url.endsWith('/auth/login/'));
    req.flush({
      username: 'admin@example.com',
      handle: 'ADM',
      is_staff: false,
      active_organization_rolle: 'admin',
    });

    expect(service.currentUser()?.rolle).toBe('admin');
  });

  it('reports a null Rolle when /me has no unambiguous active Organisation', () => {
    service.bootstrap().subscribe();

    const req = httpMock.expectOne((r) => r.method === 'GET' && r.url.endsWith('/auth/me/'));
    req.flush({
      username: 'x',
      handle: null,
      is_staff: false,
      active_organization_rolle: null,
    });

    expect(service.currentUser()?.rolle).toBeNull();
  });
});
