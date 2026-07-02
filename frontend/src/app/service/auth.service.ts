import {computed, inject, Injectable, signal} from '@angular/core';
import {HttpClient, HttpErrorResponse} from '@angular/common/http';
import {catchError, from, map, Observable, of, switchMap, tap} from 'rxjs';
import {environment} from '../../environments/environment';
import {AuthUser, OrganizationRolle} from '../models/auth-user.model';
import {Organization} from '../models/organization.model';
import {IdentityCacheService} from '../core/offline/identity-cache';
import {ReferenceBundleCacheService} from '../core/offline/reference-bundle-cache';

interface AuthUserDto {
  username: string;
  handle: string | null;
  is_staff: boolean;
  active_organization_rolle: OrganizationRolle;
  active_organization: Organization | null;
}

@Injectable({providedIn: 'root'})
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly identityCache = inject(IdentityCacheService);
  private readonly referenceBundleCache = inject(ReferenceBundleCacheService);
  private readonly authUrl = `${environment.apiUrl}/auth`;

  readonly currentUser = signal<AuthUser | null>(null);
  readonly isAuthenticated = computed(() => this.currentUser() !== null);

  /**
   * Verifies the session against the server and adopts the result as
   * `currentUser`, exactly as before — issue #156 makes no change to *online*
   * behaviour. A genuine connectivity failure — no response reached at all,
   * `HttpErrorResponse.status === 0` — falls back to the identity cached by
   * the last successful online check, so a cold boot at a Station without a
   * network still admits a previously-prepared Mitglied. A real server
   * response (401 = not authenticated) is authoritative: it clears
   * `currentUser`, the identity cache, *and* the org-scoped reference-bundle
   * cache (issue #158), so logout/expiry behave online exactly as today and
   * never resurrect a stale identity — or a previous Mitglied's cached
   * reference data — on a later offline boot on a shared device.
   */
  bootstrap(): Observable<AuthUser | null> {
    return this.http.get<AuthUserDto>(`${this.authUrl}/me/`).pipe(
      map(toAuthUser),
      switchMap((user) => this.cacheIdentity(user)),
      tap((user) => this.currentUser.set(user)),
      catchError((error: unknown) => {
        if (error instanceof HttpErrorResponse && error.status === 0) {
          return from(this.identityCache.load()).pipe(
            catchError((cacheError: unknown) => {
              // Best effort: a broken cache must not stop bootstrap() from
              // resolving (a rejected app initializer is a white screen).
              console.error('Failed to load cached identity for offline boot', cacheError);
              return of(null);
            }),
            tap((user) => this.currentUser.set(user)),
          );
        }
        this.currentUser.set(null);
        return from(this.clearCaches()).pipe(
          map(() => null),
          catchError((cacheError: unknown) => {
            console.error('Failed to clear cached identity/reference data', cacheError);
            return of(null);
          }),
        );
      }),
    );
  }

  /**
   * Fetches a fresh CSRF token cookie from the server (issue #161): before
   * replaying the offline outbox, the client needs a cookie that is
   * guaranteed current — a device that spent up to two weeks offline may
   * hold one that has since expired. Reuses `/api/auth/me/`
   * (`@ensure_csrf_cookie` server-side, the same endpoint `bootstrap()`
   * calls) purely for that cookie side effect: deliberately does not touch
   * `currentUser` or either offline cache, so a mid-trip sync attempt never
   * interferes with the app's own session-bootstrap state. A 401 here (an
   * expired session) or a connectivity failure both simply propagate to the
   * caller — `SyncService` treats either as "sync could not proceed this
   * time", pausing until the next trigger; re-login/session-expiry handling
   * is out of this issue's scope.
   */
  refreshCsrfToken(): Observable<void> {
    return this.http.get<AuthUserDto>(`${this.authUrl}/me/`).pipe(map(() => undefined));
  }

  login(username: string, password: string): Observable<AuthUser> {
    return this.http.post<AuthUserDto>(`${this.authUrl}/login/`, {username, password}).pipe(
      map(toAuthUser),
      switchMap((user) => this.cacheIdentity(user)),
      tap((user) => this.currentUser.set(user)),
    );
  }

  logout(): Observable<void> {
    return this.http.post<void>(`${this.authUrl}/logout/`, {}).pipe(
      switchMap(() => from(this.clearCaches())),
      tap(() => this.currentUser.set(null)),
    );
  }

  /**
   * Clears both the identity cache and the org-scoped reference-bundle cache
   * (issue #158) so a session invalidation never leaves either behind for a
   * different Mitglied to inherit on a shared/offline device. Each cache is
   * cleared independently and best-effort: a failure on one (e.g. IndexedDB
   * blocked) must not stop the other from being cleared, and must never
   * reject — the server-side session is already gone by this point, so a
   * cache failure must not leave `currentUser` stale.
   */
  private clearCaches(): Promise<void> {
    return Promise.all([
      this.identityCache.clear().catch((cacheError: unknown) => {
        console.error('Failed to clear cached identity', cacheError);
      }),
      this.referenceBundleCache.clear().catch((cacheError: unknown) => {
        console.error('Failed to clear the cached reference bundle', cacheError);
      }),
    ]).then(() => undefined);
  }

  private cacheIdentity(user: AuthUser): Observable<AuthUser> {
    return from(this.identityCache.save(user)).pipe(
      map(() => user),
      catchError((error: unknown) => {
        // Best effort: caching for offline use must never block a successful
        // online login/session check from completing.
        console.error('Failed to cache identity for offline use', error);
        return of(user);
      }),
    );
  }
}

function toAuthUser(dto: AuthUserDto): AuthUser {
  return {
    username: dto.username,
    handle: dto.handle,
    isStaff: dto.is_staff,
    rolle: dto.active_organization_rolle,
    organization: dto.active_organization,
  };
}
