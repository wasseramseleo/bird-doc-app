import {TestBed} from '@angular/core/testing';

import {ReferenceBundleCacheService} from './reference-bundle-cache';
import {OfflineBundle} from '../../models/offline-bundle.model';

const BUNDLE: OfflineBundle = {
  identity: {username: 'fre', handle: 'FRE', organization: null, rolle: null},
  species: [],
  ringing_stations: [],
  scientists: [],
  projects: [],
  last_consumed_ring_numbers: [],
};

describe('ReferenceBundleCacheService', () => {
  let service: ReferenceBundleCacheService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ReferenceBundleCacheService);
  });

  afterEach(async () => {
    await service.clear();
  });

  it('returns null when nothing was ever cached', async () => {
    const result = await service.load();

    expect(result).toBeNull();
  });

  it('reads back a bundle written with save()', async () => {
    await service.save({bundle: BUNDLE, refreshedAt: '2026-07-02T10:00:00.000Z'});

    const result = await service.load();

    expect(result).toEqual({bundle: BUNDLE, refreshedAt: '2026-07-02T10:00:00.000Z'});
  });

  it('overwrites the previous entry on a second save()', async () => {
    await service.save({bundle: BUNDLE, refreshedAt: '2026-07-02T10:00:00.000Z'});
    const refreshed: OfflineBundle = {...BUNDLE, species: [{...emptySpecies(), id: 's1'}]};
    await service.save({bundle: refreshed, refreshedAt: '2026-07-02T11:00:00.000Z'});

    const result = await service.load();

    expect(result?.refreshedAt).toBe('2026-07-02T11:00:00.000Z');
    expect(result?.bundle.species).toEqual([{...emptySpecies(), id: 's1'}]);
  });
});

function emptySpecies() {
  return {
    id: '',
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
