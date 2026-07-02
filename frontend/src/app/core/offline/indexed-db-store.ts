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
export const OFFLINE_DB_VERSION = 1;
export const OFFLINE_STORES = ['identity'] as const;
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
        request.onerror = () => reject(request.error);
      });
    }
    return this.dbPromise;
  }
}
