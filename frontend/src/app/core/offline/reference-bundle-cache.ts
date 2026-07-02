import {inject, Injectable} from '@angular/core';

import {OfflineBundle} from '../../models/offline-bundle.model';
import {IndexedDbStore} from './indexed-db-store';

// Single-row store: the whole app has exactly one "current" offline reference
// cache, keyed constantly — mirrors `IdentityCacheService`.
const CACHE_KEY = 'current';

export interface CachedReferenceBundle {
  bundle: OfflineBundle;
  // ISO 8601 timestamp of the fetch that produced `bundle`, read back by
  // `ReferenceCacheService` to drive the Offline-Bereitschaft indicator.
  refreshedAt: string;
}

/**
 * The offline reference-bundle cache (issue #158): the pure IndexedDB
 * read/write layer for the bundle fetched from `/api/birds/offline-bundle/`
 * (issue #157). `ReferenceCacheService` writes through on every successful
 * refresh and reads back the last-good entry to drive the readiness
 * indicator and, in later PRD #152 slices, offline reads.
 */
@Injectable({providedIn: 'root'})
export class ReferenceBundleCacheService {
  private readonly db = inject(IndexedDbStore);

  async load(): Promise<CachedReferenceBundle | null> {
    const cached = await this.db.get<CachedReferenceBundle>('referenceCache', CACHE_KEY);
    return cached ?? null;
  }

  save(entry: CachedReferenceBundle): Promise<void> {
    return this.db.put('referenceCache', CACHE_KEY, entry);
  }

  clear(): Promise<void> {
    return this.db.delete('referenceCache', CACHE_KEY);
  }
}
