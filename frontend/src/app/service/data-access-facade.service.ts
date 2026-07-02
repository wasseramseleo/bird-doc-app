import {inject, Injectable} from '@angular/core';
import {HttpErrorResponse} from '@angular/common/http';
import {catchError, from, map, Observable, of, switchMap, tap, throwError} from 'rxjs';

import {BirdStatus, DataEntry} from '../models/data-entry.model';
import {OutboxEntry} from '../models/outbox-entry.model';
import {PaginatedApiResponse} from '../models/paginated-api-response.model';
import {Project} from '../models/project.model';
import {RingingStation} from '../models/ringing-station.model';
import {RingSize} from '../models/ring.model';
import {Scientist} from '../models/scientist.model';
import {Species} from '../models/species.model';
import {ApiService} from './api.service';
import {OutboxService} from './outbox.service';
import {ConnectivityService} from '../core/offline/connectivity';
import {
  CachedReferenceBundle,
  ReferenceBundleCacheService,
} from '../core/offline/reference-bundle-cache';

/**
 * The offline-aware data-access facade (issue #159, #160, PRD #152): fronts
 * the capture-form's reads — species/Station/Beringer/Projekt pickers and
 * the ring next-number suggestion — and the capture create, behind an
 * interface shaped exactly like `ApiService`. The online path is unchanged:
 * every call attempts the real server request first, so a healthy connection
 * sees identical behaviour to calling `ApiService` directly. Only a genuine
 * connectivity failure (`HttpErrorResponse.status === 0` — the same signal
 * `AuthService.bootstrap()` already treats as "no connectivity", issue #156)
 * falls back to the IndexedDB reference-bundle cache (issue #158) for reads,
 * or the durable offline outbox (issue #160) for the capture create; any
 * other error (e.g. a 401, handled globally by the auth interceptor)
 * propagates unchanged.
 */
@Injectable({providedIn: 'root'})
export class DataAccessFacadeService {
  private readonly api = inject(ApiService);
  private readonly cache = inject(ReferenceBundleCacheService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly outbox = inject(OutboxService);

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
   * The offline ring next-number suggestion (issue #159, extended by #162):
   * the cached last-consumed (raw, un-incremented) number for this Projekt +
   * Ringgröße, combined with this device's own queued (not-yet-synced)
   * entries that drew a fresh number since that cache snapshot — a first
   * catch (Erstfang) or a destroyed-ring record (`ring_destroyed`
   * Sonderart), exactly the `_ring_consuming_entries` rule the backend uses
   * for the live suggestion and the offline bundle alike; a Wiederfang
   * consumes nothing. The most recently queued qualifying entry (if any)
   * wins over the cache — it is strictly newer, since the cache can only
   * reflect activity from before this device went offline — so consecutive
   * offline Erstfänge/Ring-vernichtet captures suggest sequential numbers.
   * Incremented by one exactly like the online suggestion
   * (`RingViewSet._increment`) — leading-zero width preserved, `null` for a
   * non-numeric number. Unlike online, there is no project-less/global
   * fallback: the cached bundle only ever groups by `(project, size)`.
   */
  getNextRingNumber(size: RingSize, projectId?: string): Observable<{next_number: string | null}> {
    return this.withOfflineFallback(this.api.getNextRingNumber(size, projectId), () =>
      this.loadCache().pipe(
        switchMap((cached) =>
          from(this.outbox.listOwnQueued()).pipe(
            map((queued) => {
              const ringDestroyedSpeciesIds = new Set(
                (cached?.bundle.species ?? [])
                  .filter((s) => s.special_kind === 'ring_destroyed')
                  .map((s) => s.id),
              );
              const fromQueue = lastQueuedConsumption(queued, size, projectId, ringDestroyedSpeciesIds);
              const lastConsumed =
                fromQueue ??
                cached?.bundle.last_consumed_ring_numbers.find(
                  (entry) => entry.project_id === projectId && entry.size === size,
                )?.number ??
                null;
              return {next_number: lastConsumed ? incrementRingNumber(lastConsumed) : null};
            }),
          ),
        ),
      ),
    );
  }

  /**
   * The offline-capable capture create — the durable-outbox tracer bullet
   * (issue #160): attempts the real POST first, exactly like `ApiService`.
   * Only a connectivity failure durably enqueues the payload into the
   * offline outbox instead (issue #160) rather than surfacing a save error,
   * so a Mitglied at a Station with no reception never loses a capture. The
   * payload already carries its client-generated idempotency UUID (#155),
   * minted once by `DataEntryFormComponent` and carried through unchanged —
   * enqueueing never mints a second one. Resolves to the created `DataEntry`
   * when saved online, or `null` when durably queued instead.
   */
  createDataEntry(payload: Partial<DataEntry>): Observable<DataEntry | null> {
    return this.withOfflineFallback(this.api.createDataEntry(payload), () =>
      this.outbox
        .enqueue(payload as Record<string, unknown> & {idempotency_key?: string | null})
        .pipe(map(() => null)),
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
 * The ring_number of the most recently queued outbox entry that consumed a
 * fresh number for this Projekt + Ringgröße (issue #162), or `null` when
 * none qualifies. `queued` is oldest-first (`OutboxService.listOwnQueued()`),
 * so the last matching element is the most recent — mirroring
 * `_ring_consuming_entries().order_by("-created").first()` on the backend.
 */
function lastQueuedConsumption(
  queued: OutboxEntry[],
  size: RingSize,
  projectId: string | undefined,
  ringDestroyedSpeciesIds: ReadonlySet<string>,
): string | null {
  const consuming = queued.filter((entry) =>
    isConsumingQueuedEntry(entry.payload, size, projectId, ringDestroyedSpeciesIds),
  );
  const latest = consuming[consuming.length - 1];
  return typeof latest?.payload['ring_number'] === 'string' ? (latest.payload['ring_number'] as string) : null;
}

/**
 * Mirrors `_ring_consuming_entries` (backend/birds/views.py) verbatim: a
 * queued capture draws a fresh number from the rope when it is a first catch
 * (Erstfang) or a destroyed-ring record (`ring_destroyed` Sonderart) — a
 * recapture (Wiederfang) consumes nothing. A `ring_destroyed` capture never
 * carries `bird_status` (the field collapses out of the form once that
 * Sonderart is selected), so its species is what marks it as consuming;
 * `ringDestroyedSpeciesIds` resolves that from the cached species pool since
 * the queued payload itself only carries a flat `species_id`.
 */
function isConsumingQueuedEntry(
  payload: Record<string, unknown>,
  size: RingSize,
  projectId: string | undefined,
  ringDestroyedSpeciesIds: ReadonlySet<string>,
): boolean {
  if (payload['ring_size'] !== size || payload['project_id'] !== projectId) {
    return false;
  }
  if (payload['bird_status'] === BirdStatus.FirstCatch) {
    return true;
  }
  const speciesId = payload['species_id'];
  return typeof speciesId === 'string' && ringDestroyedSpeciesIds.has(speciesId);
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
