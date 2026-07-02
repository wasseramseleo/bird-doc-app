import {inject, Injectable} from '@angular/core';

import {DataEntry} from '../../models/data-entry.model';
import {IndexedDbStore} from './indexed-db-store';

// Single-row store: a device only ever needs the *current* Projekt's recent
// captures cached — mirrors `ReferenceBundleCacheService`/`IdentityCacheService`.
const CACHE_KEY = 'current';

export interface CachedRecentEntries {
  // Which Projekt these entries belong to, so a Projekt switch while offline
  // shows nothing rather than another Projekt's stale captures (see
  // `DataAccessFacadeService.getTodayEntries`).
  projectId: string;
  entries: DataEntry[];
  // ISO 8601 timestamp of the fetch that produced `entries`.
  cachedAt: string;
}

/**
 * The cached-synced side of "today's session" (issue #163): the pure
 * IndexedDB read/write layer for the active Projekt's already-synced
 * captures, narrowed to today's calendar date. `DataAccessFacadeService`
 * writes through on every successful `getTodayEntries()` fetch and reads
 * back the last-good entry when the server is unreachable, so the session
 * view can still show today's synced captures (read-only) while offline.
 */
@Injectable({providedIn: 'root'})
export class RecentEntriesCacheService {
  private readonly db = inject(IndexedDbStore);

  async load(): Promise<CachedRecentEntries | null> {
    const cached = await this.db.get<CachedRecentEntries>('recentEntries', CACHE_KEY);
    return cached ?? null;
  }

  save(entry: CachedRecentEntries): Promise<void> {
    return this.db.put('recentEntries', CACHE_KEY, entry);
  }

  clear(): Promise<void> {
    return this.db.delete('recentEntries', CACHE_KEY);
  }
}
