import {computed, inject, Injectable, signal} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {catchError, map, Observable, of, tap} from 'rxjs';
import {environment} from '../../environments/environment';

export interface AuthUser {
  username: string;
  handle: string | null;
  isStaff: boolean;
}

interface AuthUserDto {
  username: string;
  handle: string | null;
  is_staff: boolean;
}

@Injectable({providedIn: 'root'})
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly authUrl = `${environment.apiUrl}/auth`;

  readonly currentUser = signal<AuthUser | null>(null);
  readonly isAuthenticated = computed(() => this.currentUser() !== null);

  bootstrap(): Observable<AuthUser | null> {
    return this.http.get<AuthUserDto>(`${this.authUrl}/me/`).pipe(
      map(toAuthUser),
      tap((user) => this.currentUser.set(user)),
      catchError(() => {
        this.currentUser.set(null);
        return of(null);
      }),
    );
  }

  login(username: string, password: string): Observable<AuthUser> {
    return this.http.post<AuthUserDto>(`${this.authUrl}/login/`, {username, password}).pipe(
      map(toAuthUser),
      tap((user) => this.currentUser.set(user)),
    );
  }

  logout(): Observable<void> {
    return this.http.post<void>(`${this.authUrl}/logout/`, {}).pipe(
      tap(() => this.currentUser.set(null)),
    );
  }
}

function toAuthUser(dto: AuthUserDto): AuthUser {
  return {
    username: dto.username,
    handle: dto.handle,
    isStaff: dto.is_staff,
  };
}
