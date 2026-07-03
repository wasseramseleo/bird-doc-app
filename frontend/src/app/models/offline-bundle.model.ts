import {OrganizationRolle} from './auth-user.model';
import {Central} from './central.model';
import {Organization} from './organization.model';
import {Project} from './project.model';
import {RingSize} from './ring.model';
import {RingingStation} from './ringing-station.model';
import {Scientist} from './scientist.model';
import {Species} from './species.model';

/**
 * The offline reference bundle (issue #157, PRD #152) — everything a device
 * caches while online to operate offline later, scoped to the requester's
 * active Organisation. Mirrors `OfflineBundleView`'s response shape
 * (`backend/birds/views.py`) field for field.
 */

export interface OfflineSpecies extends Species {
  // Per-Organisation usage count, letting the offline picker approximate the
  // most-used-first ordering `SpeciesViewSet._order_by_usage` gives online.
  usage_count: number;
}

export interface OfflineIdentity {
  username: string;
  handle: string | null;
  organization: Organization | null;
  rolle: OrganizationRolle;
}

export interface LastConsumedRingNumber {
  project_id: string;
  size: RingSize;
  // The last-consumed (raw, un-incremented) number, kept as a string like
  // `Ring.number` itself so leading-zero width survives round-tripping.
  number: string;
}

export interface OfflineBundle {
  identity: OfflineIdentity;
  species: OfflineSpecies[];
  ringing_stations: RingingStation[];
  scientists: Scientist[];
  projects: Project[];
  // The full EURING Zentralen register (#233) — global reference data like the
  // species pool, never tenant-scoped. The offline Zentrale dropdown searches
  // this cached list (name, country, scheme code) with no network.
  centrals: Central[];
  last_consumed_ring_numbers: LastConsumedRingNumber[];
}
