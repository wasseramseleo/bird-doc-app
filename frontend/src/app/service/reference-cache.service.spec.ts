import {TestBed} from '@angular/core/testing';
import {provideHttpClient} from '@angular/common/http';
import {HttpTestingController, provideHttpClientTesting} from '@angular/common/http/testing';
import {firstValueFrom} from 'rxjs';

import {ReferenceCacheService} from './reference-cache.service';
import {ReferenceBundleCacheService} from '../core/offline/reference-bundle-cache';
import {OfflineBundle} from '../models/offline-bundle.model';

const BUNDLE: OfflineBundle = {
  identity: {username: 'fre', handle: 'FRE', organization: null, rolle: 'mitglied'},
  species: [],
  ringing_stations: [],
  scientists: [],
  projects: [],
  last_consumed_ring_numbers: [],
};

describe('ReferenceCacheService', () => {
  let service: ReferenceCacheService;
  let httpMock: HttpTestingController;
  let cache: ReferenceBundleCacheService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    cache = TestBed.inject(ReferenceBundleCacheService);
  });

  afterEach(async () => {
    httpMock.verify();
    await cache.clear();
  });

  it('is not ready before any refresh has ever completed', async () => {
    service = TestBed.inject(ReferenceCacheService);
    await service.ready;

    expect(service.isReady()).toBeFalse();
    expect(service.lastRefreshedAt()).toBeNull();
  });

  it('populates the IndexedDB cache and becomes ready when refresh() succeeds', async () => {
    service = TestBed.inject(ReferenceCacheService);
    await service.ready;

    const resultPromise = firstValueFrom(service.refresh());
    const req = httpMock.expectOne((r) => r.method === 'GET' && r.url.endsWith('/offline-bundle/'));
    req.flush(BUNDLE);
    const result = await resultPromise;

    expect(result).toBeTrue();
    expect(service.isReady()).toBeTrue();
    expect(service.lastRefreshedAt()).toBeInstanceOf(Date);

    const cached = await cache.load();
    expect(cached?.bundle).toEqual(BUNDLE);
  });

  it('re-fetches and updates the cache on a second refresh() (manual "Jetzt aktualisieren")', async () => {
    service = TestBed.inject(ReferenceCacheService);
    await service.ready;

    const first = firstValueFrom(service.refresh());
    httpMock
      .expectOne((r) => r.method === 'GET' && r.url.endsWith('/offline-bundle/'))
      .flush(BUNDLE);
    await first;
    const firstRefreshedAt = service.lastRefreshedAt();

    const updatedBundle: OfflineBundle = {...BUNDLE, species: [makeSpecies('s1')]};
    const second = firstValueFrom(service.refresh());
    httpMock
      .expectOne((r) => r.method === 'GET' && r.url.endsWith('/offline-bundle/'))
      .flush(updatedBundle);
    await second;

    expect(service.lastRefreshedAt()).not.toBe(firstRefreshedAt);
    const cached = await cache.load();
    expect(cached?.bundle.species).toEqual([makeSpecies('s1')]);
  });

  it('loads a previous session\'s last-refreshed time from the persisted cache', async () => {
    await cache.save({bundle: BUNDLE, refreshedAt: '2026-06-01T09:00:00.000Z'});

    service = TestBed.inject(ReferenceCacheService);
    await service.ready;

    expect(service.isReady()).toBeTrue();
    expect(service.lastRefreshedAt()).toEqual(new Date('2026-06-01T09:00:00.000Z'));
  });

  it('keeps the last good cache and resolves false, without throwing, when refresh fails (offline)', async () => {
    await cache.save({bundle: BUNDLE, refreshedAt: '2026-06-01T09:00:00.000Z'});
    service = TestBed.inject(ReferenceCacheService);
    await service.ready;
    const readyBefore = service.lastRefreshedAt();

    const resultPromise = firstValueFrom(service.refresh());
    const req = httpMock.expectOne((r) => r.method === 'GET' && r.url.endsWith('/offline-bundle/'));
    req.error(new ProgressEvent('error'));
    const result = await resultPromise;

    expect(result).toBeFalse();
    expect(service.isReady()).toBeTrue();
    expect(service.lastRefreshedAt()).toEqual(readyBefore);
    const cached = await cache.load();
    expect(cached?.bundle).toEqual(BUNDLE);
  });

  it('does not report readiness when the bundle arrives but persisting it fails', async () => {
    service = TestBed.inject(ReferenceCacheService);
    await service.ready;
    spyOn(cache, 'save').and.returnValue(Promise.reject(new Error('quota exceeded')));

    const resultPromise = firstValueFrom(service.refresh());
    httpMock
      .expectOne((r) => r.method === 'GET' && r.url.endsWith('/offline-bundle/'))
      .flush(BUNDLE);
    const result = await resultPromise;

    expect(result).toBeFalse();
    expect(service.isReady()).toBeFalse();
    expect(service.lastRefreshedAt()).toBeNull();
  });
});

function makeSpecies(id: string) {
  return {
    id,
    common_name_de: '',
    common_name_en: '',
    scientific_name: '',
    family_name: '',
    order_name: '',
    ring_size: null,
    special_kind: '' as const,
    usage_count: 0,
  };
}
