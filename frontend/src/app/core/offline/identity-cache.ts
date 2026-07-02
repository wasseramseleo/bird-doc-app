import {inject, Injectable} from '@angular/core';

import {AuthUser} from '../../models/auth-user.model';
import {IndexedDbStore} from './indexed-db-store';

// Single-row store: the whole app has exactly one "current" cached identity
// (the account whose session was last verified online), keyed constantly.
const IDENTITY_KEY = 'current';

/**
 * The offline fallback for "who is logged in" (issue #156). `AuthService`
 * writes through on every successful login/session check and reads back from
 * here when a boot-time session check fails for lack of connectivity.
 */
@Injectable({providedIn: 'root'})
export class IdentityCacheService {
  private readonly db = inject(IndexedDbStore);

  async load(): Promise<AuthUser | null> {
    const cached = await this.db.get<AuthUser>('identity', IDENTITY_KEY);
    return cached ?? null;
  }

  save(user: AuthUser): Promise<void> {
    return this.db.put('identity', IDENTITY_KEY, user);
  }

  clear(): Promise<void> {
    return this.db.delete('identity', IDENTITY_KEY);
  }
}
