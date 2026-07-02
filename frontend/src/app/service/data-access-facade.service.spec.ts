import {TestBed} from '@angular/core/testing';
import {provideHttpClient} from '@angular/common/http';
import {HttpTestingController, provideHttpClientTesting} from '@angular/common/http/testing';
import {firstValueFrom} from 'rxjs';

import {DataAccessFacadeService} from './data-access-facade.service';
import {AuthService} from './auth.service';
import {OutboxService} from './outbox.service';
import {OutboxStoreService} from '../core/offline/outbox-store';
import {ConnectivityService} from '../core/offline/connectivity';
import {IndexedDbStore} from '../core/offline/indexed-db-store';
import {ReferenceBundleCacheService} from '../core/offline/reference-bundle-cache';
import {RecentEntriesCacheService} from '../core/offline/recent-entries-cache';
import {OfflineBundle, OfflineSpecies} from '../models/offline-bundle.model';
import {BirdStatus, DataEntry} from '../models/data-entry.model';
import {Species} from '../models/species.model';
import {RingingStation} from '../models/ringing-station.model';
import {Scientist} from '../models/scientist.model';
import {Project} from '../models/project.model';
import {RingSize} from '../models/ring.model';

function page0<T>(results: T[]) {
  return {count: results.length, next: null, previous: null, results};
}

const KOHLMEISE: Species = {
  id: 's1',
  common_name_de: 'Kohlmeise',
  common_name_en: 'Great Tit',
  scientific_name: 'Parus major',
  family_name: '',
  order_name: '',
  ring_size: null,
  special_kind: '',
};

function offlineSpecies(overrides: Partial<OfflineSpecies> = {}): OfflineSpecies {
  return {
    id: 's1',
    common_name_de: 'Kohlmeise',
    common_name_en: 'Great Tit',
    scientific_name: 'Parus major',
    family_name: '',
    order_name: '',
    ring_size: null,
    special_kind: '',
    usage_count: 0,
    ...overrides,
  };
}

const EMPTY_BUNDLE: OfflineBundle = {
  identity: {username: 'fre', handle: 'FRE', organization: null, rolle: 'mitglied'},
  species: [],
  ringing_stations: [],
  scientists: [],
  projects: [],
  last_consumed_ring_numbers: [],
};

describe('DataAccessFacadeService', () => {
  let service: DataAccessFacadeService;
  let httpMock: HttpTestingController;
  let cache: ReferenceBundleCacheService;
  let connectivity: ConnectivityService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(DataAccessFacadeService);
    httpMock = TestBed.inject(HttpTestingController);
    cache = TestBed.inject(ReferenceBundleCacheService);
    connectivity = TestBed.inject(ConnectivityService);
    // The outbox (issue #160) stamps every enqueued entry with the
    // currently authenticated account (tenancy fix) — an entry can only be
    // durably queued once someone is signed in, exactly like in the app.
    TestBed.inject(AuthService).currentUser.set({
      username: 'fre',
      handle: 'FRE',
      isStaff: false,
      rolle: 'mitglied',
      organization: null,
    });
  });

  afterEach(async () => {
    httpMock.verify();
    await cache.clear();
    await TestBed.inject(RecentEntriesCacheService).clear();
    // Issue #162's own-queue tests enqueue an unpredictable number of
    // randomly-keyed outbox rows — sweep every entry the DB actually holds
    // rather than a fixed id list, so no test leaks a stray row into the
    // next one's outbox reads.
    const db = TestBed.inject(IndexedDbStore);
    const entries = await db.getAll<{id: string}>('outbox');
    await Promise.all(entries.map((entry) => db.delete('outbox', entry.id)));
  });

  describe('getSpecies()', () => {
    it('passes the server response through unchanged while online', async () => {
      const resultPromise = firstValueFrom(service.getSpecies('Kohl', 'p1'));

      const req = httpMock.expectOne(
        (r) => r.method === 'GET' && r.url.endsWith('/birds/species/'),
      );
      expect(req.request.params.get('search')).toBe('Kohl');
      expect(req.request.params.get('project')).toBe('p1');
      req.flush(page0([KOHLMEISE]));

      const result = await resultPromise;
      expect(result.results).toEqual([KOHLMEISE]);
    });

    it('falls back to the cached species pool, keeping its cached most-used-first order, when the server is unreachable', async () => {
      const kohlmeise = offlineSpecies({id: 's1', common_name_de: 'Kohlmeise', usage_count: 5});
      const ringVernichtet = offlineSpecies({
        id: 'sv',
        common_name_de: 'Ring Vernichtet',
        common_name_en: '',
        scientific_name: '',
        special_kind: 'ring_destroyed',
        usage_count: 0,
      });
      await cache.save({
        bundle: {...EMPTY_BUNDLE, species: [kohlmeise, ringVernichtet]},
        refreshedAt: '2026-06-01T09:00:00.000Z',
      });

      const resultPromise = firstValueFrom(service.getSpecies());
      const req = httpMock.expectOne(
        (r) => r.method === 'GET' && r.url.endsWith('/birds/species/'),
      );
      req.error(new ProgressEvent('error'));

      const result = await resultPromise;
      expect(result.results).toEqual([kohlmeise, ringVernichtet]);
    });

    it('filters the cached species pool by the search term while offline', async () => {
      const kohlmeise = offlineSpecies({id: 's1', common_name_de: 'Kohlmeise'});
      const amsel = offlineSpecies({id: 's2', common_name_de: 'Amsel', scientific_name: 'Turdus merula'});
      await cache.save({
        bundle: {...EMPTY_BUNDLE, species: [kohlmeise, amsel]},
        refreshedAt: '2026-06-01T09:00:00.000Z',
      });

      const resultPromise = firstValueFrom(service.getSpecies('kohl'));
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/species/'))
        .error(new ProgressEvent('error'));

      const result = await resultPromise;
      expect(result.results).toEqual([kohlmeise]);
    });

    it('returns an empty page instead of throwing when nothing has ever been cached', async () => {
      const resultPromise = firstValueFrom(service.getSpecies());
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/species/'))
        .error(new ProgressEvent('error'));

      const result = await resultPromise;
      expect(result.results).toEqual([]);
    });
  });

  describe('getRingingStations()', () => {
    const ORGANIZATION = {id: 'o1', handle: 'IWM', name: 'IWM Linz', country: 'AT'};
    const STATION: RingingStation = {
      handle: 'STAMT',
      name: 'Linz, Botanischer Garten',
      organization: ORGANIZATION,
    };

    it('passes the server response through unchanged while online', async () => {
      const resultPromise = firstValueFrom(service.getRingingStations('Linz', 'IWM'));

      const req = httpMock.expectOne(
        (r) => r.method === 'GET' && r.url.endsWith('/birds/ringing-stations/'),
      );
      expect(req.request.params.get('search')).toBe('Linz');
      expect(req.request.params.get('organization')).toBe('IWM');
      req.flush(page0([STATION]));

      const result = await resultPromise;
      expect(result.results).toEqual([STATION]);
    });

    it('falls back to the cached Stationen, scoped to the given Organisation, when offline', async () => {
      const otherOrgStation: RingingStation = {
        handle: 'FOREIGN',
        name: 'Andere Station',
        organization: {id: 'o2', handle: 'ANDERE', name: 'Andere Org', country: 'AT'},
      };
      await cache.save({
        bundle: {...EMPTY_BUNDLE, ringing_stations: [STATION, otherOrgStation]},
        refreshedAt: '2026-06-01T09:00:00.000Z',
      });

      const resultPromise = firstValueFrom(service.getRingingStations(undefined, 'IWM'));
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/ringing-stations/'))
        .error(new ProgressEvent('error'));

      const result = await resultPromise;
      expect(result.results).toEqual([STATION]);
    });
  });

  describe('getScientists()', () => {
    const BERINGER: Scientist = {id: 'sci-1', handle: 'FRE', full_name: 'Filip Reiter'};

    it('passes the server response through unchanged while online', async () => {
      const resultPromise = firstValueFrom(service.getScientists('Filip'));

      const req = httpMock.expectOne(
        (r) => r.method === 'GET' && r.url.endsWith('/birds/scientists/'),
      );
      expect(req.request.params.get('search')).toBe('Filip');
      req.flush(page0([BERINGER]));

      const result = await resultPromise;
      expect(result.results).toEqual([BERINGER]);
    });

    it('falls back to the cached Beringer, filtered by Kürzel or name, when offline', async () => {
      const other: Scientist = {id: 'sci-2', handle: 'ANM', full_name: 'Anna Muster'};
      await cache.save({
        bundle: {...EMPTY_BUNDLE, scientists: [BERINGER, other]},
        refreshedAt: '2026-06-01T09:00:00.000Z',
      });

      const resultPromise = firstValueFrom(service.getScientists('FRE'));
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/scientists/'))
        .error(new ProgressEvent('error'));

      const result = await resultPromise;
      expect(result.results).toEqual([BERINGER]);
    });
  });

  describe('getProjects()', () => {
    const PROJECT: Project = {
      id: 'p1',
      title: 'Schilfgürtel Linz',
      description: '',
      show_optional_fields: false,
      organization: {id: 'o1', handle: 'IWM', name: 'IWM Linz', country: 'AT'},
      default_station: null,
      scientists: [],
      created: '2026-06-01T00:00:00Z',
      updated: '2026-06-01T00:00:00Z',
    };

    it('passes the server response through unchanged while online', async () => {
      const resultPromise = firstValueFrom(service.getProjects());

      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/projects/'))
        .flush(page0([PROJECT]));

      const result = await resultPromise;
      expect(result.results).toEqual([PROJECT]);
    });

    it('falls back to the cached Projekte when offline', async () => {
      await cache.save({
        bundle: {...EMPTY_BUNDLE, projects: [PROJECT]},
        refreshedAt: '2026-06-01T09:00:00.000Z',
      });

      const resultPromise = firstValueFrom(service.getProjects());
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/projects/'))
        .error(new ProgressEvent('error'));

      const result = await resultPromise;
      expect(result.results).toEqual([PROJECT]);
    });
  });

  describe('getNextRingNumber()', () => {
    it('passes the server response through unchanged while online', async () => {
      const resultPromise = firstValueFrom(service.getNextRingNumber(RingSize.V, 'p1'));

      const req = httpMock.expectOne(
        (r) => r.method === 'GET' && r.url.endsWith('/birds/rings/next-number/'),
      );
      expect(req.request.params.get('size')).toBe('V');
      expect(req.request.params.get('project')).toBe('p1');
      req.flush({next_number: '0043'});

      const result = await resultPromise;
      expect(result.next_number).toBe('0043');
    });

    it('suggests the cached last-consumed number + 1, preserving leading-zero width, when offline', async () => {
      await cache.save({
        bundle: {
          ...EMPTY_BUNDLE,
          last_consumed_ring_numbers: [{project_id: 'p1', size: RingSize.V, number: '0042'}],
        },
        refreshedAt: '2026-06-01T09:00:00.000Z',
      });

      const resultPromise = firstValueFrom(service.getNextRingNumber(RingSize.V, 'p1'));
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/rings/next-number/'))
        .error(new ProgressEvent('error'));

      const result = await resultPromise;
      expect(result.next_number).toBe('0043');
    });

    it('suggests null when the cache has no consumption for this Projekt + Ringgröße', async () => {
      await cache.save({
        bundle: {
          ...EMPTY_BUNDLE,
          last_consumed_ring_numbers: [{project_id: 'other-project', size: RingSize.V, number: '0042'}],
        },
        refreshedAt: '2026-06-01T09:00:00.000Z',
      });

      const resultPromise = firstValueFrom(service.getNextRingNumber(RingSize.V, 'p1'));
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/rings/next-number/'))
        .error(new ProgressEvent('error'));

      const result = await resultPromise;
      expect(result.next_number).toBeNull();
    });

    it('suggests null for a non-numeric cached last-consumed number, mirroring the online suggestion', async () => {
      await cache.save({
        bundle: {
          ...EMPTY_BUNDLE,
          last_consumed_ring_numbers: [{project_id: 'p1', size: RingSize.V, number: 'ABC12'}],
        },
        refreshedAt: '2026-06-01T09:00:00.000Z',
      });

      const resultPromise = firstValueFrom(service.getNextRingNumber(RingSize.V, 'p1'));
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/rings/next-number/'))
        .error(new ProgressEvent('error'));

      const result = await resultPromise;
      expect(result.next_number).toBeNull();
    });

    describe('own-queue fold-in (issue #162)', () => {
      const RING_VERNICHTET: OfflineSpecies = {
        id: 's-rv',
        common_name_de: 'Ring Vernichtet',
        common_name_en: '',
        scientific_name: '',
        family_name: '',
        order_name: '',
        ring_size: null,
        special_kind: 'ring_destroyed',
        usage_count: 0,
      };

      async function queueEntry(payload: Record<string, unknown>): Promise<void> {
        await firstValueFrom(
          TestBed.inject(OutboxService).enqueue({
            idempotency_key: `uuid-${Math.random()}`,
            ...payload,
          }),
        );
      }

      it("combines the cached last-consumed number with the device's own queued Erstfang entry, so consecutive offline Erstfänge suggest sequential numbers", async () => {
        await cache.save({
          bundle: {
            ...EMPTY_BUNDLE,
            last_consumed_ring_numbers: [{project_id: 'p1', size: RingSize.V, number: '0042'}],
          },
          refreshedAt: '2026-06-01T09:00:00.000Z',
        });
        // A first offline Erstfang has already drawn "0043" from the rope and
        // sits queued, unsynced, on this device.
        await queueEntry({
          bird_status: 'e',
          ring_size: RingSize.V,
          ring_number: '0043',
          project_id: 'p1',
        });

        const resultPromise = firstValueFrom(service.getNextRingNumber(RingSize.V, 'p1'));
        httpMock
          .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/rings/next-number/'))
          .error(new ProgressEvent('error'));

        const result = await resultPromise;
        expect(result.next_number).toBe('0044');
      });

      it('treats a queued Ring-vernichtet entry as consuming a number, exactly like a queued Erstfang', async () => {
        await cache.save({
          bundle: {
            ...EMPTY_BUNDLE,
            species: [RING_VERNICHTET],
            last_consumed_ring_numbers: [{project_id: 'p1', size: RingSize.V, number: '0042'}],
          },
          refreshedAt: '2026-06-01T09:00:00.000Z',
        });
        // A queued "Ring vernichtet" record carries no bird_status (the field
        // is hidden/collapsed once that Sonderart is selected) — only the
        // species tells the suggestion it drew a fresh number.
        await queueEntry({
          species_id: RING_VERNICHTET.id,
          ring_size: RingSize.V,
          ring_number: '0043',
          project_id: 'p1',
        });

        const resultPromise = firstValueFrom(service.getNextRingNumber(RingSize.V, 'p1'));
        httpMock
          .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/rings/next-number/'))
          .error(new ProgressEvent('error'));

        const result = await resultPromise;
        expect(result.next_number).toBe('0044');
      });

      it('does not treat a queued Wiederfang entry as consuming a number', async () => {
        await cache.save({
          bundle: {
            ...EMPTY_BUNDLE,
            last_consumed_ring_numbers: [{project_id: 'p1', size: RingSize.V, number: '0042'}],
          },
          refreshedAt: '2026-06-01T09:00:00.000Z',
        });
        await queueEntry({
          bird_status: 'w',
          ring_size: RingSize.V,
          ring_number: '0043',
          project_id: 'p1',
        });

        const resultPromise = firstValueFrom(service.getNextRingNumber(RingSize.V, 'p1'));
        httpMock
          .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/rings/next-number/'))
          .error(new ProgressEvent('error'));

        const result = await resultPromise;
        // The cached last-consumed alone ("0042" + 1) — the Wiederfang never
        // moved the rope forward.
        expect(result.next_number).toBe('0043');
      });

      it('ignores a queued consuming entry for a different Projekt or Ringgröße', async () => {
        await cache.save({
          bundle: {
            ...EMPTY_BUNDLE,
            last_consumed_ring_numbers: [{project_id: 'p1', size: RingSize.V, number: '0042'}],
          },
          refreshedAt: '2026-06-01T09:00:00.000Z',
        });
        await queueEntry({
          bird_status: 'e',
          ring_size: RingSize.V,
          ring_number: '9999',
          project_id: 'other-project',
        });
        await queueEntry({
          bird_status: 'e',
          ring_size: RingSize.T,
          ring_number: '8888',
          project_id: 'p1',
        });

        const resultPromise = firstValueFrom(service.getNextRingNumber(RingSize.V, 'p1'));
        httpMock
          .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/rings/next-number/'))
          .error(new ProgressEvent('error'));

        const result = await resultPromise;
        expect(result.next_number).toBe('0043');
      });

      it("never folds another account's queued entries into this account's suggestion (tenancy)", async () => {
        await cache.save({
          bundle: {
            ...EMPTY_BUNDLE,
            last_consumed_ring_numbers: [{project_id: 'p1', size: RingSize.V, number: '0042'}],
          },
          refreshedAt: '2026-06-01T09:00:00.000Z',
        });
        // A different Mitglied's queued Erstfang, sitting on this same
        // shared/offline device.
        await TestBed.inject(OutboxStoreService).add({
          id: 'uuid-other-account',
          accountKey: 'anm',
          payload: {bird_status: 'e', ring_size: RingSize.V, ring_number: '0099', project_id: 'p1'},
          queuedAt: '2026-06-01T09:30:00.000Z',
        });

        const resultPromise = firstValueFrom(service.getNextRingNumber(RingSize.V, 'p1'));
        httpMock
          .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/rings/next-number/'))
          .error(new ProgressEvent('error'));

        const result = await resultPromise;
        expect(result.next_number).toBe('0043');
      });

      it('falls back to the cache-derived suggestion instead of erroring when the own-queue read fails', async () => {
        await cache.save({
          bundle: {
            ...EMPTY_BUNDLE,
            last_consumed_ring_numbers: [{project_id: 'p1', size: RingSize.V, number: '0042'}],
          },
          refreshedAt: '2026-06-01T09:00:00.000Z',
        });
        // A broken IndexedDB read (quota exceeded, blocked storage, or a DB
        // open failure right after crash/reboot recovery) must degrade to
        // "nothing queued" rather than error the suggestion out from under
        // the Mitglied while they are already offline.
        spyOn(TestBed.inject(OutboxService), 'listOwnQueued').and.returnValue(
          Promise.reject(new Error('IndexedDB blocked')),
        );

        const resultPromise = firstValueFrom(service.getNextRingNumber(RingSize.V, 'p1'));
        httpMock
          .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/rings/next-number/'))
          .error(new ProgressEvent('error'));

        const result = await resultPromise;
        expect(result.next_number).toBe('0043');
      });
    });
  });

  describe('getTodayEntries() (issue #163, "today\'s session")', () => {
    function isoAt(hoursAgoFromMidnight: number, dayOffset = 0): string {
      const d = new Date();
      d.setDate(d.getDate() + dayOffset);
      d.setHours(hoursAgoFromMidnight, 0, 0, 0);
      return d.toISOString();
    }

    function syncedEntry(overrides: Partial<DataEntry> = {}): DataEntry {
      return {
        id: 'e1',
        species: {
          id: 's1',
          common_name_de: 'Kohlmeise',
          common_name_en: 'Great Tit',
          scientific_name: 'Parus major',
          family_name: '',
          order_name: '',
          ring_size: null,
          special_kind: '',
        },
        ring: {id: 'r1', number: '0043', size: RingSize.V},
        staff: {id: 'sci-1', handle: 'FRE', full_name: 'Filip Reiter'},
        ringing_station: {handle: 'STAMT', name: 'Linz, Botanischer Garten'},
        project: null,
        net_location: null,
        net_height: null,
        net_direction: null,
        feather_span: null,
        wing_span: null,
        tarsus: null,
        notch_f2: null,
        inner_foot: null,
        weight_gram: null,
        bird_status: BirdStatus.FirstCatch,
        fat_deposit: null,
        muscle_class: null,
        age_class: 2 as DataEntry['age_class'],
        sex: 0 as DataEntry['sex'],
        small_feather_int: null,
        small_feather_app: null,
        hand_wing: null,
        date_time: isoAt(9),
        created: isoAt(9),
        updated: isoAt(9),
        comment: null,
        has_mites: false,
        has_hunger_stripes: false,
        has_brood_patch: false,
        has_cpl_plus: false,
        ...overrides,
      } as DataEntry;
    }

    it('fetches the Projekt\'s entries and narrows them to today\'s calendar date while online', async () => {
      const today = syncedEntry({id: 'today-1', date_time: isoAt(9)});
      const yesterday = syncedEntry({id: 'yesterday-1', date_time: isoAt(9, -1)});
      const resultPromise = firstValueFrom(service.getTodayEntries('p1'));

      const req = httpMock.expectOne(
        (r) => r.method === 'GET' && r.url.endsWith('/birds/data-entries/'),
      );
      expect(req.request.params.get('project')).toBe('p1');
      req.flush(page0([today, yesterday]));

      const result = await resultPromise;
      expect(result.map((e) => e.id)).toEqual(['today-1']);
    });

    it('caches today\'s entries for offline reading', async () => {
      const today = syncedEntry({id: 'today-1'});
      const resultPromise = firstValueFrom(service.getTodayEntries('p1'));
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/data-entries/'))
        .flush(page0([today]));
      await resultPromise;

      const cached = await TestBed.inject(RecentEntriesCacheService).load();
      expect(cached?.projectId).toBe('p1');
      expect(cached?.entries.map((e) => e.id)).toEqual(['today-1']);
    });

    it('falls back to the cached entries for the same Projekt when offline', async () => {
      const today = syncedEntry({id: 'today-1'});
      await TestBed.inject(RecentEntriesCacheService).save({
        projectId: 'p1',
        entries: [today],
        cachedAt: '2026-06-01T09:00:00.000Z',
      });

      const resultPromise = firstValueFrom(service.getTodayEntries('p1'));
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/data-entries/'))
        .error(new ProgressEvent('error'));

      const result = await resultPromise;
      expect(result.map((e) => e.id)).toEqual(['today-1']);
    });

    it('returns an empty list offline when the cache belongs to a different Projekt', async () => {
      await TestBed.inject(RecentEntriesCacheService).save({
        projectId: 'other-project',
        entries: [syncedEntry()],
        cachedAt: '2026-06-01T09:00:00.000Z',
      });

      const resultPromise = firstValueFrom(service.getTodayEntries('p1'));
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/data-entries/'))
        .error(new ProgressEvent('error'));

      const result = await resultPromise;
      expect(result).toEqual([]);
    });

    it('returns an empty list instead of throwing when nothing has ever been cached', async () => {
      const resultPromise = firstValueFrom(service.getTodayEntries('p1'));
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/data-entries/'))
        .error(new ProgressEvent('error'));

      const result = await resultPromise;
      expect(result).toEqual([]);
    });
  });

  describe('createDataEntry() (issue #160, the offline durable outbox)', () => {
    function payload(): Partial<DataEntry> {
      return {
        idempotency_key: 'uuid-1',
        species_id: 's1',
        ring_number: '0043',
      } as unknown as Partial<DataEntry>;
    }

    it('passes the server response through unchanged while online, and never touches the outbox', async () => {
      const created: Partial<DataEntry> = {id: 'server-1'};
      const resultPromise = firstValueFrom(service.createDataEntry(payload()));

      const req = httpMock.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'),
      );
      req.flush(created);

      const result = await resultPromise;
      expect(result).toEqual(created as DataEntry);
      expect(await TestBed.inject(OutboxStoreService).list()).toEqual([]);
    });

    it('durably enqueues the payload into the outbox instead of erroring when the server is unreachable', async () => {
      const resultPromise = firstValueFrom(service.createDataEntry(payload()));

      httpMock
        .expectOne((r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'))
        .error(new ProgressEvent('error'));

      const result = await resultPromise;
      expect(result).toBeNull();

      const queued = await TestBed.inject(OutboxStoreService).list();
      expect(queued.length).toBe(1);
      expect(queued[0].id).toBe('uuid-1');
      expect(queued[0].payload).toEqual(payload() as unknown as Record<string, unknown>);
    });

    it('marks the app offline once the create falls back to the outbox', async () => {
      expect(connectivity.isOffline()).toBeFalse();

      const resultPromise = firstValueFrom(service.createDataEntry(payload()));
      httpMock
        .expectOne((r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'))
        .error(new ProgressEvent('error'));
      await resultPromise;

      expect(connectivity.isOffline()).toBeTrue();
    });

    it('increments the outbox pending count on enqueue', async () => {
      const outbox = TestBed.inject(OutboxService);
      await outbox.ready;
      expect(outbox.pendingCount()).toBe(0);

      const resultPromise = firstValueFrom(service.createDataEntry(payload()));
      httpMock
        .expectOne((r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'))
        .error(new ProgressEvent('error'));
      await resultPromise;

      expect(outbox.pendingCount()).toBe(1);
    });

    it('does not treat a non-connectivity error (e.g. a validation 400) as offline, and propagates it unchanged instead of enqueueing', async () => {
      const resultPromise = firstValueFrom(service.createDataEntry(payload()));
      let caught: unknown;
      resultPromise.catch((error: unknown) => (caught = error));

      httpMock
        .expectOne((r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'))
        .flush({detail: 'Ungültige Ringnummer.'}, {status: 400, statusText: 'Bad Request'});

      await expectAsync(resultPromise).toBeRejected();
      expect(connectivity.isOffline()).toBeFalse();
      expect((caught as {status?: number} | undefined)?.status).toBe(400);
      expect(await TestBed.inject(OutboxStoreService).list()).toEqual([]);
    });
  });

  describe('connectivity signalling', () => {
    it('marks the app offline once a read falls back to the cache', async () => {
      expect(connectivity.isOffline()).toBeFalse();

      const resultPromise = firstValueFrom(service.getSpecies());
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/species/'))
        .error(new ProgressEvent('error'));
      await resultPromise;

      expect(connectivity.isOffline()).toBeTrue();
    });

    it('marks the app online again once a read reaches the server after an offline period', async () => {
      const offlineRead = firstValueFrom(service.getSpecies());
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/species/'))
        .error(new ProgressEvent('error'));
      await offlineRead;
      expect(connectivity.isOffline()).toBeTrue();

      const onlineRead = firstValueFrom(service.getSpecies());
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/species/'))
        .flush(page0([]));
      await onlineRead;

      expect(connectivity.isOffline()).toBeFalse();
    });

    it('does not treat a non-connectivity error (e.g. a 401) as offline, and propagates it unchanged', async () => {
      const resultPromise = firstValueFrom(service.getSpecies());
      let caught: unknown;
      resultPromise.catch((error: unknown) => (caught = error));

      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/species/'))
        .flush({detail: 'Not authenticated.'}, {status: 401, statusText: 'Unauthorized'});

      await expectAsync(resultPromise).toBeRejected();
      expect(connectivity.isOffline()).toBeFalse();
      expect((caught as {status?: number} | undefined)?.status).toBe(401);
    });
  });
});
