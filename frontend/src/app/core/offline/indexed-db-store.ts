import {Injectable, OnDestroy} from '@angular/core';

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
export const OFFLINE_DB_VERSION = 6;
// v2 (issue #158) adds 'referenceCache' — the offline reference bundle
// (species pool, org reference data, last-consumed ring numbers) plus its
// last-refreshed timestamp, read/written by `ReferenceBundleCacheService`.
// v3 (issue #160) adds 'outbox' — the durable offline outbox: one record per
// queued capture-create payload, keyed by its own idempotency UUID (#155),
// read/written by `OutboxStoreService`.
// v4 (issue #163) adds 'recentEntries' — the cached-synced side of "today's
// session": the last fetch of the active Projekt's already-synced captures,
// narrowed to today's calendar date, read/written by
// `RecentEntriesCacheService` so the session view can still show them
// (read-only) while offline.
// v5 (issue #167) adds 'pendingBeringer' — no-account Beringer quick-added
// while offline: one record per queued Beringer, keyed by a client-generated
// placeholder id that dependent captures reference until sync creates (or
// Kürzel-matches) the real Beringer, read/written by
// `PendingBeringerStoreService`.
// v6 (issue #445, PRD #438) adds no store: it versions a *record shape*. A
// flagged 'outbox' entry no longer carries one line of prose but the whole
// rejection beside it (`OutboxEntry.syncErrorEnvelope` — Klasse, Code, Text,
// Feld, Kontext), so a rejected entry re-opened days later renders its complete
// banner with no network at all. Nothing is migrated: an entry an older bundle
// flagged keeps its plain `syncError` string and reads as a bare `detail` with
// no code — a device offline for weeks holds exactly those, and inventing a
// code for one would put a claim on the record that nobody ever made.
export const OFFLINE_STORES = [
  'identity',
  'referenceCache',
  'outbox',
  'recentEntries',
  'pendingBeringer',
] as const;
export type OfflineStoreName = (typeof OFFLINE_STORES)[number];

/**
 * The upgrade itself: create any store missing from a prior version, and touch
 * nothing else — existing stores and their data are never dropped, so a version
 * that only changes a *record* shape (v6, issue #445) passes through as a no-op
 * and leaves every queued capture exactly as its bundle wrote it.
 *
 * Exported so the upgrade can be *exercised* rather than promised
 * (`indexed-db-store.spec.ts`): a spec drives the real handler across a version
 * step on a database of its own, since re-opening the shared `birddoc-offline`
 * at an older version would depend on which spec ran first.
 */
export function ensureOfflineStores(db: IDBDatabase): void {
  for (const storeName of OFFLINE_STORES) {
    if (!db.objectStoreNames.contains(storeName)) {
      db.createObjectStore(storeName);
    }
  }
}

/**
 * How many consecutive idle macrotask turns `whenIdle()` needs to see before it
 * calls the store quiet. One reading is not enough: an operation is very often
 * only *queued* by the completion of the one before it (resolve the queued
 * entry, then read its reference bundle), so a single `pending === 0` can land
 * in the gap between the two and report idle mid-chain.
 *
 * It is a window, not a barrier: work that reaches the store more than three
 * turns after the last operation finished — behind an HTTP response, say — is
 * not covered, and such a spec has to await that other thing itself.
 */
const QUIET_TURNS_REQUIRED = 3;

/**
 * How long `whenIdle()` will wait for a store that never goes quiet before it
 * gives up and says so. Deliberately well past any real round-trip: this is not
 * a deadline the suite is meant to race — it exists so an operation that never
 * settles fails with a sentence that names the cause, instead of spinning
 * `setTimeout` for the rest of the run.
 */
const WHEN_IDLE_CEILING_MS = 10_000;

/**
 * Thin promise-based wrapper over the native IndexedDB API — a generic,
 * key/value store per named object store. Deliberately dumb: no querying, no
 * transactions spanning multiple stores. Callers that need structured offline
 * data (the identity cache today; reference-data caches and the outbox in
 * later PRD #152 slices) build a small typed service on top of this.
 */

@Injectable({providedIn: 'root'})
export class IndexedDbStore implements OnDestroy {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private pending = 0;

  get<T>(storeName: OfflineStoreName, key: string): Promise<T | undefined> {
    return this.track(
      this.openDb().then(
        (db) =>
          new Promise<T | undefined>((resolve, reject) => {
            const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
            request.onsuccess = () => resolve(request.result as T | undefined);
            request.onerror = () => reject(request.error);
          }),
      ),
    );
  }

  put<T>(storeName: OfflineStoreName, key: string, value: T): Promise<void> {
    return this.track(
      this.openDb().then(
        (db) =>
          new Promise<void>((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          }),
      ),
    );
  }

  /**
   * Every value currently in the store, in no particular order — the outbox
   * (issue #160) uses this to enumerate its queued entries; callers that
   * need a stable order (e.g. capture order) sort the result themselves.
   */
  getAll<T>(storeName: OfflineStoreName): Promise<T[]> {
    return this.track(
      this.openDb().then(
        (db) =>
          new Promise<T[]>((resolve, reject) => {
            const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
            request.onsuccess = () => resolve(request.result as T[]);
            request.onerror = () => reject(request.error);
          }),
      ),
    );
  }

  delete(storeName: OfflineStoreName, key: string): Promise<void> {
    return this.track(
      this.openDb().then(
        (db) =>
          new Promise<void>((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          }),
      ),
    );
  }

  /**
   * Resolves once nothing is in flight — the seam a spec awaits instead of
   * guessing at the round-trip with `setTimeout(…, 20)` (issue #464).
   *
   * IndexedDB is *not* patched by Zone, so this work is invisible to both
   * `fixture.whenStable()` and a plain microtask await; before this existed the
   * only handle a spec had on it was elapsed wall-clock time. A fixed budget is
   * a bet that the machine is not momentarily busy, and across ~1300 specs that
   * bet is lost often enough to drop one or two — at a different place every
   * run, which is exactly what made the red runs look like real regressions.
   *
   * Production code never calls this: the app has no reason to wait for
   * quiescence, only for its own operation.
   */
  async whenIdle(): Promise<void> {
    const giveUpAt = Date.now() + WHEN_IDLE_CEILING_MS;
    for (let quietTurns = 0; quietTurns < QUIET_TURNS_REQUIRED; ) {
      if (Date.now() > giveUpAt) {
        throw new Error(
          `IndexedDbStore.whenIdle() gave up after ${WHEN_IDLE_CEILING_MS} ms with ` +
            `${this.pending} operation(s) still in flight — one of them never settled.`,
        );
      }
      quietTurns = this.pending === 0 ? quietTurns + 1 : 0;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  /**
   * Closes the connection when the injector that created this store is
   * destroyed.
   *
   * In the browser that is app teardown, so the behaviour there is exactly what
   * it always was: one page, one connection, held open for the page's lifetime.
   * Under Karma it is what stops the leak (issue #464) — the whole suite runs in
   * a single page, every `TestBed` builds a fresh root injector and so a fresh
   * `IndexedDbStore`, and without this each one left another open handle on the
   * shared `birddoc-offline`. Stacked up over ~1300 specs those handles are what
   * a version-changing open would sit `blocked` behind.
   */
  ngOnDestroy(): void {
    const closing = this.dbPromise;
    // Dropped first, so a call arriving after teardown opens a fresh connection
    // rather than being handed the handle we are about to close.
    this.dbPromise = null;
    closing?.then(
      (db) => db.close(),
      () => {
        // An open that already failed has nothing to close, and its rejection
        // was the business of whoever awaited it.
      },
    );
  }

  /**
   * Counts an operation as in flight for as long as it runs, so `whenIdle()`
   * can tell a quiet store from one mid-round-trip. Settled either way: a
   * rejected read is finished work too.
   */
  private track<T>(work: Promise<T>): Promise<T> {
    this.pending++;
    const settled = () => {
      this.pending--;
    };
    work.then(settled, settled);
    return work;
  }

  private openDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
        // A blocked open cannot be cancelled: the browser still completes it
        // once the older connection goes away. Nobody is waiting for it by
        // then, so the connection it hands back has to be closed here — an open
        // handle nobody holds is the very leak this change is about.
        let abandoned = false;
        request.onupgradeneeded = () => ensureOfflineStores(request.result);
        request.onsuccess = () => {
          if (abandoned) {
            request.result.close();
            return;
          }
          resolve(request.result);
        };
        // A version-changing open sits `blocked` while an older connection is
        // still open. Unhandled it is the one outcome nobody recovers from: the
        // request never succeeds and never errors, so every awaiting caller
        // simply hangs. Treated as the transient failure it is, the caller
        // learns, and the retry below gets its turn once the old connection goes.
        request.onblocked = () => {
          abandoned = true;
          this.dbPromise = null;
          reject(new DOMException('IndexedDB open blocked by an older connection', 'BlockedError'));
        };
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
