import {HttpErrorResponse, HttpInterceptorFn} from '@angular/common/http';
import {inject} from '@angular/core';
import {Router} from '@angular/router';
import {catchError, throwError} from 'rxjs';
import {AuthService} from '../../service/auth.service';
import {getCookie} from '../util/cookie';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const authService = inject(AuthService);

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
