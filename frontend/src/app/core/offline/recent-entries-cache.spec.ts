import {TestBed} from '@angular/core/testing';

import {RecentEntriesCacheService} from './recent-entries-cache';
import {DataEntry} from '../../models/data-entry.model';

function entry(overrides: Partial<DataEntry> = {}): DataEntry {
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
    ring: {id: 'r1', number: '0043', size: 'V'} as DataEntry['ring'],
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
    bird_status: 'e' as DataEntry['bird_status'],
    fat_deposit: null,
    muscle_class: null,
    age_class: 2 as DataEntry['age_class'],
    sex: 0 as DataEntry['sex'],
    small_feather_int: null,
    small_feather_app: null,
    hand_wing: null,
    date_time: '2026-07-02T09:00:00.000Z',
    created: '2026-07-02T09:00:00.000Z',
    updated: '2026-07-02T09:00:00.000Z',
    comment: null,
    has_mites: false,
    has_hunger_stripes: false,
    has_brood_patch: false,
    has_cpl_plus: false,
    is_dead_recovery: false,
    is_non_standard: false,
    ...overrides,
  };
}

describe('RecentEntriesCacheService', () => {
  let service: RecentEntriesCacheService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(RecentEntriesCacheService);
  });

  afterEach(async () => {
    await service.clear();
  });

  it('returns null when nothing was ever cached', async () => {
    const result = await service.load();

    expect(result).toBeNull();
  });

  it('reads back the entries written with save(), scoped to their Projekt', async () => {
    await service.save({
      projectId: 'p1',
      entries: [entry()],
      cachedAt: '2026-07-02T10:00:00.000Z',
    });

    const result = await service.load();

    expect(result).toEqual({
      projectId: 'p1',
      entries: [entry()],
      cachedAt: '2026-07-02T10:00:00.000Z',
    });
  });

  it('overwrites the previous entry on a second save(), e.g. after switching Projekt', async () => {
    await service.save({projectId: 'p1', entries: [entry()], cachedAt: '2026-07-02T10:00:00.000Z'});
    const refreshed = [entry({id: 'e2'})];
    await service.save({projectId: 'p2', entries: refreshed, cachedAt: '2026-07-02T11:00:00.000Z'});

    const result = await service.load();

    expect(result?.projectId).toBe('p2');
    expect(result?.entries).toEqual(refreshed);
  });
});
