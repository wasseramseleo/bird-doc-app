import {Injectable} from '@angular/core';

/**
 * The single app-wide offline database (issue #156). All offline *data* lives
 * here, in named object stores — never in LocalStorage, which stays reserved
 * for the small workbench preferences it already holds (see
 * `WorkbenchStorageService`).
 *
 * New offline slices add a store name here and bump `OFFLINE_DB_VERSION`;
 * `IndexedDbStore` creates any store missing from a prior version on upgrade,
 * so existing stores/data are never dropped.
 */
export const OFFLINE_DB_NAME = 'birddoc-offline';
export const OFFLINE_DB_VERSION = 3;
// v2 (issue #158) adds 'referenceCache' — the offline reference bundle
// (species pool, org reference data, last-consumed ring numbers) plus its
// last-refreshed timestamp, read/written by `ReferenceBundleCacheService`.
// v3 (issue #160) adds 'outbox' — the durable offline outbox: one record per
// queued capture-create payload, keyed by its own idempotency UUID (#155),
// read/written by `OutboxStoreService`.
export const OFFLINE_STORES = ['identity', 'referenceCache', 'outbox'] as const;
export type OfflineStoreName = (typeof OFFLINE_STORES)[number];

/**
 * Thin promise-based wrapper over the native IndexedDB API — a generic,
 * key/value store per named object store. Deliberately dumb: no querying, no
 * transactions spanning multiple stores. Callers that need structured offline
 * data (the identity cache today; reference-data caches and the outbox in
 * later PRD #152 slices) build a small typed service on top of this.
 */
@Injectable({providedIn: 'root'})
export class IndexedDbStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  get<T>(storeName: OfflineStoreName, key: string): Promise<T | undefined> {
    return this.openDb().then(
      (db) =>
        new Promise<T | undefined>((resolve, reject) => {
          const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
          request.onsuccess = () => resolve(request.result as T | undefined);
          request.onerror = () => reject(request.error);
        }),
    );
  }

  put<T>(storeName: OfflineStoreName, key: string, value: T): Promise<void> {
    return this.openDb().then(
      (db) =>
        new Promise<void>((resolve, reject) => {
          const tx = db.transaction(storeName, 'readwrite');
          tx.objectStore(storeName).put(value, key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        }),
    );
  }

  /**
   * Every value currently in the store, in no particular order — the outbox
   * (issue #160) uses this to enumerate its queued entries; callers that
   * need a stable order (e.g. capture order) sort the result themselves.
   */
  getAll<T>(storeName: OfflineStoreName): Promise<T[]> {
    return this.openDb().then(
      (db) =>
        new Promise<T[]>((resolve, reject) => {
          const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
          request.onsuccess = () => resolve(request.result as T[]);
          request.onerror = () => reject(request.error);
        }),
    );
  }

  delete(storeName: OfflineStoreName, key: string): Promise<void> {
    return this.openDb().then(
      (db) =>
        new Promise<void>((resolve, reject) => {
          const tx = db.transaction(storeName, 'readwrite');
          tx.objectStore(storeName).delete(key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        }),
    );
  }

  private openDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          for (const storeName of OFFLINE_STORES) {
            if (!db.objectStoreNames.contains(storeName)) {
              db.createObjectStore(storeName);
            }
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
          // Don't let a transient failure (blocked upgrade, quota, disabled
          // storage) wedge every future call for the rest of the page's
          // lifetime — allow the next get()/put()/delete() to retry the open.
          this.dbPromise = null;
          reject(request.error);
        };
      });
    }
    return this.dbPromise;
  }
}
