import {Central} from '../../models/central.model';
import {OfflineBundle} from '../../models/offline-bundle.model';
import {RingingStation} from '../../models/ringing-station.model';
import {Scientist} from '../../models/scientist.model';
import {Species} from '../../models/species.model';

export interface QueuedEntryDisplay {
  species: Species | null;
  ringingStation: RingingStation | null;
  staff: Scientist | null;
  central: Central | null;
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
    central: resolveCentral(payload['central']),
  };
}

/**
 * Reconstructs the Zentrale (#232) from a queued entry's flat write payload.
 * The write shape carries a foreign Zentrale only as its bare EURING scheme
 * code (a string like `'SKB'`), and a domestic capture omits `central`
 * entirely — it defaults to the Projekt-Zentrale, so an absent value resolves
 * to `null` here and the caller keeps that default. Unlike species/Station/
 * Beringer, the Zentralen list is not part of the offline reference bundle, so
 * this rebuilds a `Central` from the scheme code alone. That is enough for the
 * capture form: `scheme_code` is the frontend's only comparison key on a
 * Zentrale (central.model) — it drives `isForeignCentral()`, keeps the foreign
 * free-text Ringgröße intact, and rides the re-save payload — and the id is
 * never needed. The name is unrecoverable offline, so the scheme code stands in
 * as the display label until the field is (online) re-picked.
 */
function resolveCentral(raw: unknown): Central | null {
  if (typeof raw !== 'string' || raw === '') {
    return null;
  }
  return {id: '', scheme_code: raw, name: raw, country: ''};
}
