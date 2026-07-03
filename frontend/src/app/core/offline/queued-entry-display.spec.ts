import {resolveQueuedEntryDisplay} from './queued-entry-display';
import {OfflineBundle, OfflineIdentity} from '../../models/offline-bundle.model';

const IDENTITY: OfflineIdentity = {username: 'fre', handle: 'FRE', organization: null, rolle: 'mitglied'};

function bundle(overrides: Partial<OfflineBundle> = {}): OfflineBundle {
  return {
    identity: IDENTITY,
    species: [],
    ringing_stations: [],
    scientists: [],
    projects: [],
    last_consumed_ring_numbers: [],
    ...overrides,
  };
}

describe('resolveQueuedEntryDisplay()', () => {
  it('resolves species, Station and Beringer from the cached bundle by their payload ids', () => {
    const kohlmeise = {
      id: 's1',
      common_name_de: 'Kohlmeise',
      common_name_en: 'Great Tit',
      scientific_name: 'Parus major',
      family_name: '',
      order_name: '',
      ring_size: null,
      special_kind: '' as const,
      usage_count: 3,
    };
    const station = {handle: 'STAMT', name: 'Linz, Botanischer Garten'};
    const staff = {id: 'sci-1', handle: 'FRE', full_name: 'Filip Reiter'};

    const result = resolveQueuedEntryDisplay(
      {species_id: 's1', ringing_station_id: 'STAMT', staff_id: 'sci-1'},
      bundle({species: [kohlmeise], ringing_stations: [station], scientists: [staff]}),
    );

    expect(result.species).toEqual(kohlmeise);
    expect(result.ringingStation).toEqual(station);
    expect(result.staff).toEqual(staff);
  });

  it('resolves everything to null when there is no cached bundle', () => {
    const result = resolveQueuedEntryDisplay(
      {species_id: 's1', ringing_station_id: 'STAMT', staff_id: 'sci-1'},
      null,
    );

    expect(result).toEqual({species: null, ringingStation: null, staff: null, central: null});
  });

  it('resolves to null for an id that is no longer in the cached bundle', () => {
    const result = resolveQueuedEntryDisplay(
      {species_id: 'gone', ringing_station_id: 'GONE', staff_id: 'gone'},
      bundle(),
    );

    expect(result).toEqual({species: null, ringingStation: null, staff: null, central: null});
  });

  // #232/#163: the outbox carries a foreign Zentrale only as its bare scheme
  // code; it must resolve back to a Central object so the queued-edit form can
  // reopen in free-text mode (the Zentralen list is not in the offline bundle,
  // so it is rebuilt from the scheme code alone).
  it('reconstructs a foreign Zentrale from the payload scheme code', () => {
    const result = resolveQueuedEntryDisplay(
      {species_id: 's1', ringing_station_id: 'STAMT', staff_id: 'sci-1', central: 'SKB'},
      bundle(),
    );

    expect(result.central).toEqual({id: '', scheme_code: 'SKB', name: 'SKB', country: ''});
  });

  it('leaves the Zentrale null when the payload omits central (a domestic capture keeps its Projekt-Zentrale default)', () => {
    const result = resolveQueuedEntryDisplay(
      {species_id: 's1', ringing_station_id: 'STAMT', staff_id: 'sci-1'},
      bundle(),
    );

    expect(result.central).toBeNull();
  });
});
