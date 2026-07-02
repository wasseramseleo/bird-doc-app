import {TestBed} from '@angular/core/testing';
import {provideHttpClient} from '@angular/common/http';
import {HttpTestingController, provideHttpClientTesting} from '@angular/common/http/testing';
import {firstValueFrom} from 'rxjs';

import {DataAccessFacadeService} from './data-access-facade.service';
import {ConnectivityService} from '../core/offline/connectivity';
import {ReferenceBundleCacheService} from '../core/offline/reference-bundle-cache';
import {OfflineBundle, OfflineSpecies} from '../models/offline-bundle.model';
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
  });

  afterEach(async () => {
    httpMock.verify();
    await cache.clear();
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
