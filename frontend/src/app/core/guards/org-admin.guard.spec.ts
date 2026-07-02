import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';

import { orgAdminGuard } from './org-admin.guard';
import { AuthService } from '../../service/auth.service';

function runGuard(): boolean | UrlTree {
  return TestBed.runInInjectionContext(() =>
    orgAdminGuard(null as never, { url: '/stationen' } as never),
  ) as boolean | UrlTree;
}

describe('orgAdminGuard', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  it('lets an org admin through', () => {
    TestBed.inject(AuthService).currentUser.set({
      username: 'adm',
      handle: 'ADM',
      isStaff: false,
      rolle: 'admin',
      organization: null,
    });

    expect(runGuard()).toBeTrue();
  });

  it('redirects a plain Mitglied to the home page', () => {
    TestBed.inject(AuthService).currentUser.set({
      username: 'mem',
      handle: 'MEM',
      isStaff: false,
      rolle: 'mitglied',
      organization: null,
    });

    const result = runGuard();
    expect(result).toEqual(TestBed.inject(Router).createUrlTree(['/']));
  });

  it('redirects when there is no active-organization Rolle', () => {
    TestBed.inject(AuthService).currentUser.set(null);

    const result = runGuard();
    expect(result instanceof UrlTree).toBeTrue();
  });
});
