import {computed, inject, Injectable, signal} from '@angular/core';
import {HttpClient, HttpErrorResponse} from '@angular/common/http';
import {catchError, from, map, Observable, switchMap, tap} from 'rxjs';
import {environment} from '../../environments/environment';
import {AuthUser, OrganizationRolle} from '../models/auth-user.model';
import {Organization} from '../models/organization.model';
import {IdentityCacheService} from '../core/offline/identity-cache';

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
   * response (401 = not authenticated) is authoritative: it clears both
   * `currentUser` and the cache, so logout/expiry behave online exactly as
   * today and never resurrect a stale identity on a later offline boot.
   */
  bootstrap(): Observable<AuthUser | null> {
    return this.http.get<AuthUserDto>(`${this.authUrl}/me/`).pipe(
      map(toAuthUser),
      switchMap((user) => this.cacheIdentity(user)),
      tap((user) => this.currentUser.set(user)),
      catchError((error: unknown) => {
        if (error instanceof HttpErrorResponse && error.status === 0) {
          return from(this.identityCache.load()).pipe(tap((user) => this.currentUser.set(user)));
        }
        this.currentUser.set(null);
        return from(this.identityCache.clear()).pipe(map(() => null));
      }),
    );
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
      switchMap(() => from(this.identityCache.clear())),
      tap(() => this.currentUser.set(null)),
    );
  }

  private cacheIdentity(user: AuthUser): Observable<AuthUser> {
    return from(this.identityCache.save(user)).pipe(map(() => user));
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
