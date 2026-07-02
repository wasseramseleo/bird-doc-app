import {HttpErrorResponse, HttpInterceptorFn} from '@angular/common/http';
import {inject} from '@angular/core';
import {Router} from '@angular/router';
import {catchError, throwError} from 'rxjs';
import {AuthService} from '../../service/auth.service';
import {getCookie} from '../util/cookie';
import {IdentityCacheService} from '../offline/identity-cache';
import {ReferenceBundleCacheService} from '../offline/reference-bundle-cache';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const authService = inject(AuthService);
  const identityCache = inject(IdentityCacheService);
  const referenceBundleCache = inject(ReferenceBundleCacheService);

  const headers: Record<string, string> = {};
  if (UNSAFE_METHODS.has(req.method.toUpperCase())) {
    const csrfToken = getCookie('csrftoken');
    if (csrfToken) {
      headers['X-CSRFToken'] = csrfToken;
    }
  }

  const cloned = req.clone({
    withCredentials: true,
    setHeaders: headers,
  });

  return next(cloned).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && err.status === 401 && !isAuthRequest(req.url)) {
        authService.currentUser.set(null);
        // A confirmed "not authenticated" here is the same signal bootstrap()
        // treats as logout/expiry (issue #156): clear the cached identity too,
        // so a later offline boot can't resurrect the expired session. Also
        // clear the org-scoped reference-bundle cache (issue #158) — a shared
        // device left signed out here must not leave the next Mitglied's
        // offline boot inheriting this Organisation's cached reference data.
        // Best effort — an IndexedDB failure here must not block the redirect.
        identityCache.clear().catch(() => undefined);
        referenceBundleCache.clear().catch(() => undefined);
        const next = router.url && router.url !== '/login' ? router.url : '/';
        router.navigate(['/login'], {queryParams: {next}});
      }
      return throwError(() => err);
    }),
  );
};

function isAuthRequest(url: string): boolean {
  return url.includes('/api/auth/');
}
