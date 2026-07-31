import {inject, Injectable} from '@angular/core';
import {HttpErrorResponse} from '@angular/common/http';
import {catchError, defer, from, map, Observable, of, switchMap, tap, throwError} from 'rxjs';

import {BirdStatus, DataEntry} from '../models/data-entry.model';
import {Central} from '../models/central.model';
import {OfflineBundle} from '../models/offline-bundle.model';
import {OutboxEntry, PAYLOAD_SCHEMA_VERSION} from '../models/outbox-entry.model';
import {PaginatedApiResponse} from '../models/paginated-api-response.model';
import {Project} from '../models/project.model';
import {Ring, RingSize} from '../models/ring.model';
import {RingingStation} from '../models/ringing-station.model';
import {Scientist, ScientistCreatePayload} from '../models/scientist.model';
import {SpecialKind, Species} from '../models/species.model';
import {ApiService} from './api.service';
import {OutboxService} from './outbox.service';
import {PendingBeringerService} from './pending-beringer.service';
import {appFailureOf, attachAppFailure, Fehlerklasse} from '../core/errors/app-failure';
import {attachDurablyQueued, durableWrite} from '../core/offline/durable-write';
import {ConnectivityService} from '../core/offline/connectivity';
import {
  CachedReferenceBundle,
  ReferenceBundleCacheService,
} from '../core/offline/reference-bundle-cache';
import {RecentEntriesCacheService} from '../core/offline/recent-entries-cache';
import {resolveQueuedEntryDisplay} from '../core/offline/queued-entry-display';

/**
 * A ring's recapture history (issue #168): the earlier captures of one ring
 * the Wiederfang form's "Bisherige Fänge" panel shows. Online it is the
 * server's authoritative list; offline it is assembled from what this device
 * knows locally (queued + cached captures), which is why it carries
 * `possiblyIncomplete` — the panel warns the Beringer the offline history may
 * be missing captures made on other devices or before this device's cache
 * snapshot.
 */
export interface RingHistory {
  entries: DataEntry[];
  possiblyIncomplete: boolean;
}

/**
 * Was das Mitglied erfährt, wenn eine abgelaufene Sitzung einen dauerhaften
 * Schreibvorgang zurückgewiesen hat (#447, ADR 0039). Der Ausweg („Bitte melde
 * dich erneut an.") kommt aus der Fehlerklasse und steht im Banner dahinter.
 */
const FANG_GESICHERT =
  'Der Eintrag ist auf diesem Gerät gesichert und wird nach der Anmeldung übertragen.';
const BERINGER_GESICHERT =
  'Der Beringer ist auf diesem Gerät gesichert und wird nach der Anmeldung übertragen.';

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
 * other error propagates unchanged.
 *
 * Mit einer Ausnahme, und sie ist eine Regel (#447, ADR 0039): **eine
 * abgelaufene Sitzung rettet, was sonst nirgends existiert.** Ein Fang-Create
 * und eine Beringer-Schnellanlage werden auf einen 401 hin genauso eingereiht
 * wie auf einen Verbindungsabbruch — erst danach kommt die Aufforderung zur
 * erneuten Anmeldung ({@link withDurableFallback}). Jeder Lesevorgang und jeder
 * andere Schreibvorgang scheitert an einem 401 unverändert laut.
 */
@Injectable({providedIn: 'root'})
export class DataAccessFacadeService {
  private readonly api = inject(ApiService);
  private readonly cache = inject(ReferenceBundleCacheService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly outbox = inject(OutboxService);
  private readonly pendingBeringer = inject(PendingBeringerService);
  private readonly recentEntriesCache = inject(RecentEntriesCacheService);

  /**
   * The species picker's read — and, with `specialKind`, the Sonderart lookup
   * (#427). Online the server narrows the candidates on the `special_kind`
   * discriminator; offline the cached pool is filtered by that very same key —
   * the same discriminator the queued-capture rope-consumption rule already
   * keys on ({@link isConsumingQueuedEntry}). Both paths therefore answer
   * identically by construction, not by coincidence: a Sonderart the server
   * would return is exactly the one the cache returns, and neither path depends
   * on a German display name or on where usage ordering happens to place it.
   */
  getSpecies(
    searchTerm?: string,
    projectId?: string,
    specialKind?: SpecialKind,
  ): Observable<PaginatedApiResponse<Species>> {
    return this.withOfflineFallback(this.api.getSpecies(searchTerm, projectId, specialKind), () =>
      this.loadCache().pipe(
        map((cached) => {
          const pool = cached?.bundle.species ?? [];
          const candidates = specialKind
            ? pool.filter((s) => s.special_kind === specialKind)
            : pool;
          const filtered = filterBySearch(candidates, searchTerm, (s) => [
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
          // Fold this device's own offline quick-added (not-yet-synced) Beringer
          // (issue #167) in front of the cached org Beringer, so a Beringer
          // added at a remote Station is selectable in the same offline session
          // — even across a reload — before they ever reach the server.
          const pool = [...this.pendingBeringer.pendingScientists(), ...(cached?.bundle.scientists ?? [])];
          const filtered = filterBySearch(pool, searchTerm, (s) => [s.handle, s.full_name]);
          return toPage(filtered);
        }),
      ),
    );
  }

  /**
   * The offline-capable no-account Beringer quick-add (issue #167): attempts the
   * real POST first, exactly like `ApiService`, so a healthy connection creates
   * the Beringer server-side immediately. Only a connectivity failure durably
   * queues the Beringer into the pending-Beringer store instead (issue #167) and
   * hands back a local placeholder `Scientist` — carrying the client id its
   * dependent captures reference in the same session — rather than surfacing an
   * error. On sync the queued Beringer is created before its dependent captures
   * and matched by Kürzel if one already exists server-side (see `SyncService`).
   * Any other error (e.g. a 400) propagates unchanged, like every other read.
   *
   * Eine abgelaufene Sitzung reiht ihn genauso ein (#447, ADR 0039): der
   * Beringer ist an einer Station ohne Empfang angelegt worden und existiert
   * sonst nirgends — dieselbe Begründung wie beim Fang. Anders als dort bleibt
   * es beim Fehlschlag: die Schnellanlage steht mitten in einer Erfassung, und
   * das Mitglied erfährt an dieser Stelle, dass es sich neu anmelden muss.
   */
  createScientist(payload: ScientistCreatePayload): Observable<Scientist> {
    return this.withDurableFallback(
      this.api.createScientist(payload, durableWrite()),
      () => this.pendingBeringer.enqueue(payload),
      BERINGER_GESICHERT,
    );
  }

  getProjects(): Observable<PaginatedApiResponse<Project>> {
    return this.withOfflineFallback(this.api.getProjects(), () =>
      this.loadCache().pipe(map((cached) => toPage(cached?.bundle.projects ?? []))),
    );
  }

  /**
   * The offline-capable Zentrale (EURING scheme) lookup (#233): attempts the
   * real `/centrals/` search first — the online path is `ApiService`'s
   * behaviour unchanged — and only a connectivity failure falls back to the
   * cached Zentralen register the offline bundle carries (issue #157/#233).
   * The offline search matches the same fields the server's `SearchFilter`
   * does for the online dropdown from #232: name, country and scheme code, all
   * case-insensitively; an empty term returns the whole register. This is what
   * lets a Beringer pick a foreign Zentrale for an ausländischer Wiederfang
   * while standing at a Station with no reception.
   */
  getCentrals(searchTerm?: string): Observable<PaginatedApiResponse<Central>> {
    return this.withOfflineFallback(this.api.getCentrals(searchTerm), () =>
      this.loadCache().pipe(
        map((cached) => {
          const register = cached?.bundle.centrals ?? [];
          return toPage(
            filterBySearch(register, searchTerm, (c) => [c.name, c.country, c.scheme_code]),
          );
        }),
      ),
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
   * fallback: the cached bundle only ever groups by `(project, size)`. Both
   * the cache read ({@link loadCache}) and the own-queue read
   * ({@link loadOwnQueued}) are best-effort — a broken read degrades to
   * "nothing there" rather than erroring the suggestion out from under the
   * Mitglied.
   */
  getNextRingNumber(size: RingSize, projectId?: string): Observable<{next_number: string | null}> {
    return this.withOfflineFallback(this.api.getNextRingNumber(size, projectId), () =>
      this.loadCache().pipe(
        switchMap((cached) =>
          this.loadOwnQueued().pipe(
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
   * "Today's session" (issue #163): the active Projekt's already-synced
   * captures, narrowed to today's calendar date — the cached-synced half of
   * the session view, alongside the account-scoped queued entries
   * `OutboxService.pendingEntries()` supplies. The API has no date filter,
   * so the narrowing happens client-side over a generously large page (a
   * single day's session is never anywhere close to it).
   *
   * Every successful online fetch writes through to
   * `RecentEntriesCacheService` so the same (already-narrowed) list can be
   * read back while offline. A connectivity failure falls back to that
   * cache, but only when it belongs to the *same* Projekt — a stale
   * snapshot from a Projekt switched away from while offline would
   * misattribute captures, so it degrades to an empty list instead, mirroring
   * the other caches' best-effort degradation.
   */
  getTodayEntries(projectId: string): Observable<DataEntry[]> {
    const online$ = this.api.getDataEntries({projectId, page: 1, pageSize: 200}).pipe(
      map((response) => response.results.filter(isToday)),
      tap((entries) => {
        this.recentEntriesCache
          .save({projectId, entries, cachedAt: new Date().toISOString()})
          .catch((error: unknown) =>
            console.error('Failed to cache today\'s entries for offline reading', error),
          );
      }),
    );
    return this.withOfflineFallback(online$, () =>
      from(this.recentEntriesCache.load()).pipe(
        map((cached) => (cached && cached.projectId === projectId ? cached.entries : [])),
        catchError((error: unknown) => {
          console.error('Failed to read the cached today\'s entries', error);
          return of([]);
        }),
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
   *
   * The POST carries this bundle's payload schema stamp (issue #408, ADR 0033).
   * The stamp is not an outbox concern: it tells the server which contract a
   * payload speaks, and an ordinary online capture speaks one exactly like a
   * replayed one does — here freezing and sending are simply the same instant, so
   * the claim is true by construction. Leaving it off would make an absent stamp
   * mean two things at once — "the pre-versioning contract" *and* "an ordinary
   * capture from today" — which would strand every online capture the day the
   * migratable floor legitimately rises above the pre-versioning contract, and
   * would apply an old contract's migration step to a current payload before then.
   *
   * It is stamped *here* rather than in `ApiService.createDataEntry`, which the
   * replay shares: there the payload already carries the stamp of the bundle that
   * froze it, and re-stamping would overwrite that frozen claim with today's —
   * destroying the drift the stamp exists to make legible. The enqueued copy is
   * deliberately left unstamped for the same reason `OutboxEntry` keeps its stamp
   * beside the payload: `payload` stays verbatim what the form would have POSTed,
   * and `SyncService` merges the entry's own stamp in on the way out.
   */
  createDataEntry(payload: Partial<DataEntry>): Observable<DataEntry | null> {
    const stamped = {...payload, schema_version: PAYLOAD_SCHEMA_VERSION} as Partial<DataEntry>;
    return this.withDurableFallback(
      this.api.createDataEntry(stamped, durableWrite()),
      () =>
        this.outbox
          .enqueue(payload as Record<string, unknown> & {idempotency_key?: string | null})
          .pipe(map(() => null)),
      FANG_GESICHERT,
    );
  }

  /**
   * A ring's recapture history for the Wiederfang "Bisherige Fänge" panel
   * (issue #168). Online it is the server's authoritative list — passed
   * through byte-for-byte, flagged complete. Only a connectivity failure
   * assembles it locally instead, from what this device knows: its own queued
   * (nicht synchronisiert) captures for that ring folded together with the
   * cached recent captures (issue #163's "today's session" cache) for it,
   * flagged `possiblyIncomplete` so the panel can warn the Beringer the
   * history may be missing captures made on another device or before this
   * device's cache snapshot. Both local reads are best-effort — a broken
   * IndexedDB read degrades to "nothing there" rather than erroring the
   * lookup out from under a Mitglied who is already offline. Queued captures
   * are account-scoped (`listOwnQueued`, issue #160's tenancy boundary), so a
   * shared/offline device never leaks another Mitglied's queue into this
   * history.
   */
  getRingHistory(ringSize: RingSize, ringNumber: string): Observable<RingHistory> {
    return this.withOfflineFallback(
      this.api
        .getDataEntriesByRing(ringSize, ringNumber)
        .pipe(map((response) => ({entries: response.results, possiblyIncomplete: false}))),
      () =>
        this.loadCache().pipe(
          switchMap((cached) =>
            this.loadOwnQueued().pipe(
              switchMap((queued) =>
                this.loadRecentEntries().pipe(
                  map((recent) =>
                    assembleLocalRingHistory(
                      ringSize,
                      ringNumber,
                      queued,
                      recent,
                      cached?.bundle ?? null,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
    );
  }

  /**
   * Die Dauerhaftigkeit (#447, ADR 0039): wie {@link withOfflineFallback}, und
   * **zusätzlich rettet eine abgelaufene Sitzung den Inhalt**, statt ihn zu
   * vernichten.
   *
   * Nur für die beiden Schreibvorgänge, deren Inhalt sonst nirgends existiert —
   * den Fang-Create und die Beringer-Schnellanlage. Ein Fang-Edit, eine Station,
   * ein Projekt und eine Artennorm gehen nicht durch diese Fassade und scheitern
   * damit weiterhin laut: das Original ist unversehrt, die Korrektur steht noch
   * im Formular.
   *
   * Die Reihenfolge ist die ganze Sache: **erst ist der Inhalt sicher, dann
   * kommt die Aufforderung zur erneuten Anmeldung.** Der `authInterceptor` hält
   * bei einem so markierten Schreibvorgang seine 401-Arbeit deshalb zurück
   * (`DURABLE_WRITE`) — sonst wäre das angemeldete Konto gelöscht, bevor die
   * Outbox unter ihm einreihen kann, und der Fang mit ihm. Abgemeldet wird erst,
   * wenn das Mitglied „Anmelden" im Banner drückt; bis dahin reiht sich auch der
   * nächste Fang noch ein.
   *
   * Die Klasse entscheidet, nicht der Status (ADR 0037): *Neu anmelden* deckt
   * den 401 ab und ebenso DRFs auf 403 degradierten `not_authenticated`.
   */
  private withDurableFallback<T>(
    online$: Observable<T>,
    durable$: () => Observable<T>,
    gesichert: string,
  ): Observable<T> {
    return this.withOfflineFallback(online$, durable$).pipe(
      catchError((error: unknown) => {
        if (appFailureOf(error).klasse !== Fehlerklasse.NeuAnmelden) {
          return throwError(() => error);
        }
        return defer(durable$).pipe(
          map(() => true),
          catchError((queueError: unknown) => {
            // Die Rettung selbst kann scheitern (IndexedDB blockiert, kein
            // angemeldetes Konto mehr). Dann bleibt es beim blanken
            // Sitzungsfehler — ohne das Versprechen, der Eintrag sei gesichert.
            console.error('Failed to durably queue the write a dead session refused', queueError);
            return of(false);
          }),
          switchMap((queued) => throwError(() => sessionExpiredFailure(error, queued, gesichert))),
        );
      }),
    );
  }

  /**
   * Attempts the real server request first — the online path is byte-for-byte
   * `ApiService`'s behaviour. Only a connectivity failure
   * (`HttpErrorResponse.status === 0`) routes to `offline$`; any other error
   * (e.g. a 400) propagates unchanged — an expired session is the one
   * exception, and it lives in {@link withDurableFallback}.
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

  /**
   * Best-effort own-queue read (issue #162), mirroring {@link loadCache}: a
   * broken IndexedDB read (quota exceeded, blocked/disabled storage, or a DB
   * open failure right after crash/reboot recovery — see
   * `IndexedDbStore.openDb()`) must degrade to "nothing queued" rather than
   * error the ring-number suggestion out from under the Mitglied while they
   * are already offline. The cache-derived suggestion still applies in that
   * case.
   */
  private loadOwnQueued(): Observable<OutboxEntry[]> {
    return from(this.outbox.listOwnQueued()).pipe(
      catchError((error: unknown) => {
        console.error('Failed to read the offline outbox queue', error);
        return of([]);
      }),
    );
  }

  /**
   * Best-effort read of the cached recent captures (issue #163's "today's
   * session" cache), mirroring {@link loadCache}/{@link loadOwnQueued}: the
   * cached-synced half of the offline ring history (issue #168). A broken
   * IndexedDB read degrades to "nothing cached" rather than erroring the ring
   * lookup out from under a Mitglied who is already offline; the queued half
   * still applies. Not Projekt-scoped here — a ring's history is global to
   * that ring, and the cache only ever holds one Projekt's captures anyway.
   */
  private loadRecentEntries(): Observable<DataEntry[]> {
    return from(this.recentEntriesCache.load()).pipe(
      map((cached) => cached?.entries ?? []),
      catchError((error: unknown) => {
        console.error('Failed to read the cached recent entries', error);
        return of([]);
      }),
    );
  }
}

/**
 * Der Fehlschlag, wie das Mitglied ihn zu sehen bekommt: die Sitzung ist
 * abgelaufen — und der Inhalt ist trotzdem sicher.
 *
 * Additiv wie überall (ADR 0038): derselbe Fehler reist weiter, mit einer neuen
 * Einordnung und der Markierung, dass sein Inhalt eingereiht ist. Die Klasse
 * bleibt *Neu anmelden*, also trägt das Banner den Knopf „Anmelden" — die
 * Anmeldung ist aus der Meldung heraus erreichbar. Ist die Rettung selbst
 * gescheitert, wird nichts versprochen: der Fehler geht, wie er kam.
 */
function sessionExpiredFailure(error: unknown, queued: boolean, gesichert: string): unknown {
  if (!queued) {
    return error;
  }
  const failure = appFailureOf(error);
  return attachDurablyQueued(attachAppFailure(error, {...failure, text: gesichert}));
}

function toPage<T>(results: T[]): PaginatedApiResponse<T> {
  return {count: results.length, next: null, previous: null, results};
}

/**
 * Assembles a ring's offline recapture history (issue #168) from the two
 * things a device knows locally about it: its own queued (nicht
 * synchronisiert) captures and the cached recent captures. Both are narrowed
 * to the exact ring (size + number). The queued captures carry the flat
 * write-shape payload (`species_id`/`staff_id`/…), so each is resolved back to
 * the nested records the history table renders via the already-cached
 * reference bundle, exactly like "today's session" renders the queue. A
 * queued capture wins over a cached one that shares its idempotency key — the
 * local, possibly-edited version is newer than any synced snapshot — though in
 * practice the two never overlap (a queued capture is by definition not yet
 * synced). Sorted oldest-first by capture time, matching how the panel reads
 * a bird's catch history.
 */
/**
 * The ring number a locally-held capture is matched under (#404): its stored
 * value stripped of surrounding whitespace. The capture form now trims before
 * queueing, but the outbox is durable — an entry queued by an earlier build can
 * still hold a raw `" 0043 "`, and a strict `===` against the (trimmed) searched
 * ring would leave the bird's own Erstfang invisible at its next Wiederfang, on
 * the very device that recorded it. Normalising on read makes those entries
 * findable without rewriting anything already in the queue. Only the ends are
 * noise — an inner space belongs to the number ("AB 1234" is not "AB1234").
 */
function localRingNumber(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function assembleLocalRingHistory(
  ringSize: RingSize,
  ringNumber: string,
  queued: OutboxEntry[],
  recent: DataEntry[],
  bundle: OfflineBundle | null,
): RingHistory {
  const fromQueue = queued
    .filter(
      (entry) =>
        entry.payload['ring_size'] === ringSize &&
        localRingNumber(entry.payload['ring_number']) === ringNumber,
    )
    .map((entry) => queuedEntryToHistoryEntry(entry, bundle));
  const queuedKeys = new Set(
    fromQueue.map((entry) => entry.idempotency_key).filter((key): key is string => !!key),
  );
  const fromCache = recent.filter(
    (entry) =>
      entry.ring?.size === ringSize &&
      entry.ring?.number === ringNumber &&
      !(entry.idempotency_key && queuedKeys.has(entry.idempotency_key)),
  );
  const entries = [...fromCache, ...fromQueue].sort((a, b) =>
    a.date_time.localeCompare(b.date_time),
  );
  return {entries, possiblyIncomplete: true};
}

/**
 * Reconstructs a display-ready `DataEntry` from a queued capture's flat
 * write-shape payload (issue #168), so the offline ring-history table can
 * render it exactly like a server record. Species/Station/Beringer are
 * resolved from the cached reference bundle (via `resolveQueuedEntryDisplay`,
 * the same lookup "today's session" uses); the ring is taken from the
 * payload's own size + number; the id and idempotency key are the queued
 * entry's own. The bird measurements/classifications ride along from the
 * spread payload unchanged.
 */
function queuedEntryToHistoryEntry(entry: OutboxEntry, bundle: OfflineBundle | null): DataEntry {
  const payload = entry.payload;
  const display = resolveQueuedEntryDisplay(payload, bundle);
  return {
    ...(payload as Partial<DataEntry>),
    id: entry.id,
    idempotency_key: entry.id,
    species: display.species as Species,
    ringing_station: display.ringingStation as RingingStation,
    staff: display.staff as Scientist,
    ring: {
      id: '',
      size: payload['ring_size'] as RingSize,
      // #404: render the ring the same way the server would — DRF trims on write,
      // so the synced row shows "0043". A queued row must not read " 0043 " in the
      // history table purely because it has not been sent yet.
      number: localRingNumber(payload['ring_number']),
    } as Ring,
    date_time: (payload['date_time'] as string) ?? entry.queuedAt,
  } as DataEntry;
}

// "Today" is the device's own local calendar date (Austrian field hardware —
// LOCALE_ID 'de-AT'), matching the date a Beringer would call "today's
// session" regardless of the UTC offset `date_time` is serialized in.
function isToday(entry: DataEntry): boolean {
  const captured = new Date(entry.date_time);
  const now = new Date();
  return (
    captured.getFullYear() === now.getFullYear() &&
    captured.getMonth() === now.getMonth() &&
    captured.getDate() === now.getDate()
  );
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
