import {computed, inject, Injectable, signal} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {catchError, from, map, Observable, of, switchMap, tap} from 'rxjs';

import {environment} from '../../environments/environment';
import {ReferenceBundleCacheService} from '../core/offline/reference-bundle-cache';
import {OfflineBundle} from '../models/offline-bundle.model';

/**
 * Keeps the offline reference bundle (issue #157) cached in IndexedDB and
 * fresh — the Offline-Bereitschaft indicator's data source (issue #158,
 * PRD #152). Read-through for the offline picker/reference data itself is a
 * later PRD #152 slice; this service only owns fetch-and-cache plus the
 * readiness signals.
 */
@Injectable({providedIn: 'root'})
export class ReferenceCacheService {
  private readonly http = inject(HttpClient);
  private readonly cache = inject(ReferenceBundleCacheService);
  private readonly bundleUrl = `${environment.apiUrl}/birds/offline-bundle/`;

  readonly lastRefreshedAt = signal<Date | null>(null);
  // Offline-capable exactly when a bundle has ever been cached — a fresh
  // fetch this session or one restored from a previous session below.
  readonly isReady = computed(() => this.lastRefreshedAt() !== null);

  /**
   * Resolves once any reference cache persisted by a previous session has
   * been loaded, so a Mitglied who reloads offline still sees their real
   * Offline-Bereitschaft instead of a spurious "not ready" before a network
   * refresh has had a chance to run.
   */
  readonly ready: Promise<void> = this.restorePersisted();

  private async restorePersisted(): Promise<void> {
    try {
      const cached = await this.cache.load();
      if (cached) {
        this.lastRefreshedAt.set(new Date(cached.refreshedAt));
      }
    } catch (error) {
      console.error('Failed to load the persisted offline reference cache', error);
    }
  }

  /**
   * Fetches the current offline reference bundle and stores it, becoming
   * the new "last good cache". A network failure, server error, *or* a
   * failure to persist the fetched bundle (e.g. IndexedDB quota/blocked)
   * degrades gracefully (issue #158): the previous cache and readiness state
   * are left untouched — readiness only ever reflects a bundle that is
   * actually sitting in IndexedDB — and the returned observable resolves to
   * `false` rather than erroring, so refresh() is safe to fire-and-forget
   * from an app boot, a reconnect event, or the manual "Jetzt aktualisieren"
   * action alike.
   */
  refresh(): Observable<boolean> {
    return this.http.get<OfflineBundle>(this.bundleUrl).pipe(
      switchMap((bundle) => {
        const refreshedAt = new Date();
        return from(this.cache.save({bundle, refreshedAt: refreshedAt.toISOString()})).pipe(
          map(() => refreshedAt),
        );
      }),
      tap((refreshedAt) => this.lastRefreshedAt.set(refreshedAt)),
      map(() => true),
      catchError((error: unknown) => {
        console.error('Failed to refresh the offline reference cache', error);
        return of(false);
      }),
    );
  }
}
