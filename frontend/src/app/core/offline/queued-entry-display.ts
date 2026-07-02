import {OfflineBundle} from '../../models/offline-bundle.model';
import {RingingStation} from '../../models/ringing-station.model';
import {Scientist} from '../../models/scientist.model';
import {Species} from '../../models/species.model';

export interface QueuedEntryDisplay {
  species: Species | null;
  ringingStation: RingingStation | null;
  staff: Scientist | null;
}

/**
 * Resolves a queued outbox entry's flat write-shape payload
 * (`species_id`/`ringing_station_id`/`staff_id`, exactly what
 * `DataEntryFormComponent.transformFromForm` produces) back to the nested
 * records the capture form and "today's session" list (issue #163) display
 * — by looking them up in the already-cached offline reference bundle
 * (issue #158). A queued entry itself never stores the nested objects (it is
 * the literal POST payload, replayed verbatim by sync); this is the read
 * side that reconstructs a display from it.
 *
 * Best-effort and pure: an id no longer in the cache (or no cache at all)
 * resolves to `null` for that field rather than throwing — the caller
 * decides how to render an unresolved reference (e.g. showing the raw id).
 */
export function resolveQueuedEntryDisplay(
  payload: Record<string, unknown>,
  bundle: OfflineBundle | null,
): QueuedEntryDisplay {
  const speciesId = payload['species_id'];
  const stationHandle = payload['ringing_station_id'];
  const staffId = payload['staff_id'];
  return {
    species: bundle?.species.find((species) => species.id === speciesId) ?? null,
    ringingStation:
      bundle?.ringing_stations.find((station) => station.handle === stationHandle) ?? null,
    staff: bundle?.scientists.find((scientist) => scientist.id === staffId) ?? null,
  };
}
