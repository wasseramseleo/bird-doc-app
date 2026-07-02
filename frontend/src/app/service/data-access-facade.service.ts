import {inject, Injectable} from '@angular/core';
import {HttpErrorResponse} from '@angular/common/http';
import {catchError, from, map, Observable, of, tap, throwError} from 'rxjs';

import {PaginatedApiResponse} from '../models/paginated-api-response.model';
import {Project} from '../models/project.model';
import {RingingStation} from '../models/ringing-station.model';
import {RingSize} from '../models/ring.model';
import {Scientist} from '../models/scientist.model';
import {Species} from '../models/species.model';
import {ApiService} from './api.service';
import {ConnectivityService} from '../core/offline/connectivity';
import {
  CachedReferenceBundle,
  ReferenceBundleCacheService,
} from '../core/offline/reference-bundle-cache';

/**
 * The offline-aware data-access facade (issue #159, PRD #152): fronts the
 * capture-form's reads — species/Station/Beringer/Projekt pickers and the
 * ring next-number suggestion — behind an interface shaped exactly like
 * `ApiService`. The online path is unchanged: every call attempts the real
 * server request first, so a healthy connection sees identical behaviour to
 * calling `ApiService` directly. Only a genuine connectivity failure
 * (`HttpErrorResponse.status === 0` — the same signal `AuthService.bootstrap()`
 * already treats as "no connectivity", issue #156) falls back to the
 * IndexedDB reference-bundle cache (issue #158); any other error (e.g. a 401,
 * handled globally by the auth interceptor) propagates unchanged.
 */
@Injectable({providedIn: 'root'})
export class DataAccessFacadeService {
  private readonly api = inject(ApiService);
  private readonly cache = inject(ReferenceBundleCacheService);
  private readonly connectivity = inject(ConnectivityService);

  getSpecies(searchTerm?: string, projectId?: string): Observable<PaginatedApiResponse<Species>> {
    return this.withOfflineFallback(this.api.getSpecies(searchTerm, projectId), () =>
      this.loadCache().pipe(
        map((cached) => {
          const pool = cached?.bundle.species ?? [];
          const filtered = filterBySearch(pool, searchTerm, (s) => [
            s.common_name_de,
            s.scientific_name,
          ]);
          return toPage(filtered);
        }),
      ),
    );
  }

  getRingingStations(
    searchTerm?: string,
    organizationHandle?: string,
  ): Observable<PaginatedApiResponse<RingingStation>> {
    const online$ = this.api.getRingingStations(searchTerm, organizationHandle);
    return this.withOfflineFallback(online$, () =>
      this.loadCache().pipe(
        map((cached) => {
          const stations = cached?.bundle.ringing_stations ?? [];
          const scoped = organizationHandle
            ? stations.filter((s) => s.organization?.handle === organizationHandle)
            : stations;
          return toPage(filterBySearch(scoped, searchTerm, (s) => [s.name, s.handle]));
        }),
      ),
    );
  }

  getScientists(searchTerm?: string): Observable<PaginatedApiResponse<Scientist>> {
    return this.withOfflineFallback(this.api.getScientists(searchTerm), () =>
      this.loadCache().pipe(
        map((cached) => {
          const pool = cached?.bundle.scientists ?? [];
          const filtered = filterBySearch(pool, searchTerm, (s) => [s.handle, s.full_name]);
          return toPage(filtered);
        }),
      ),
    );
  }

  getProjects(): Observable<PaginatedApiResponse<Project>> {
    return this.withOfflineFallback(this.api.getProjects(), () =>
      this.loadCache().pipe(map((cached) => toPage(cached?.bundle.projects ?? []))),
    );
  }

  /**
   * The offline ring next-number suggestion (issue #159): the cached
   * last-consumed (raw, un-incremented) number for this Projekt + Ringgröße,
   * incremented by one exactly like the online suggestion
   * (`RingViewSet._increment`) — leading-zero width preserved, `null` for a
   * non-numeric number. Unlike online, there is no project-less/global
   * fallback: the cached bundle only ever groups by `(project, size)`. The
   * device's own queued captures are folded in by a later PRD #152 slice
   * (issue #160's follow-up) — this suggestion is cache-only.
   */
  getNextRingNumber(size: RingSize, projectId?: string): Observable<{next_number: string | null}> {
    return this.withOfflineFallback(this.api.getNextRingNumber(size, projectId), () =>
      this.loadCache().pipe(
        map((cached) => {
          const lastConsumed = cached?.bundle.last_consumed_ring_numbers.find(
            (entry) => entry.project_id === projectId && entry.size === size,
          );
          return {next_number: lastConsumed ? incrementRingNumber(lastConsumed.number) : null};
        }),
      ),
    );
  }

  /**
   * Attempts the real server request first — the online path is byte-for-byte
   * `ApiService`'s behaviour. Only a connectivity failure
   * (`HttpErrorResponse.status === 0`) routes to `offline$`; any other error
   * (e.g. a 401, already handled globally by the auth interceptor) propagates
   * unchanged.
   */
  private withOfflineFallback<T>(
    online$: Observable<T>,
    offline$: () => Observable<T>,
  ): Observable<T> {
    return online$.pipe(
      tap(() => this.connectivity.markOnline()),
      catchError((error: unknown) => {
        if (error instanceof HttpErrorResponse && error.status === 0) {
          this.connectivity.markOffline();
          return offline$();
        }
        return throwError(() => error);
      }),
    );
  }

  /**
   * Best-effort cache read: a broken IndexedDB read must degrade to "nothing
   * cached" rather than error the picker/suggestion out from under the
   * Mitglied while they are already offline.
   */
  private loadCache(): Observable<CachedReferenceBundle | null> {
    return from(this.cache.load()).pipe(
      catchError((error: unknown) => {
        console.error('Failed to read the offline reference cache', error);
        return of(null);
      }),
    );
  }
}

function toPage<T>(results: T[]): PaginatedApiResponse<T> {
  return {count: results.length, next: null, previous: null, results};
}

// Mirrors `RingViewSet._increment` (backend/birds/views.py) verbatim: the
// numeric value is incremented while the original width is preserved
// (`"0042"` → `"0043"`); a non-numeric number has nothing sensible to
// suggest, so it returns `null`.
function incrementRingNumber(number: string): string | null {
  if (!/^\d+$/.test(number)) {
    return null;
  }
  return String(Number(number) + 1).padStart(number.length, '0');
}

/**
 * Case-insensitive substring match across the given fields, mirroring DRF's
 * `SearchFilter` behaviour the online endpoints use. An empty/absent
 * `searchTerm` returns every candidate unfiltered, exactly like the online
 * picker leaving the `search` query param off entirely.
 */
function filterBySearch<T>(
  candidates: T[],
  searchTerm: string | undefined,
  fields: (item: T) => (string | null | undefined)[],
): T[] {
  if (!searchTerm) {
    return candidates;
  }
  const needle = searchTerm.toLowerCase();
  return candidates.filter((item) =>
    fields(item).some((field) => (field ?? '').toLowerCase().includes(needle)),
  );
}
