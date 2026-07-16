import {RingSize} from './ring.model';

// Artennorm models (PRD #245, issue #251, ADR 0021).
//
// The tunable rule columns of an Artennorm. Numeric bands ride the wire as
// decimal strings (Django DecimalField); a null Ø/SD pair — or a null flag —
// means that particular Ausreißertest is off (whole-row semantics, ADR 0021), so
// clearing a field in an override disables just that check for the Organisation.
export interface SpeciesNormRules {
  weight_mean: string | null;
  weight_sd: string | null;
  feather_mean: string | null;
  feather_sd: string | null;
  wing_mean: string | null;
  wing_sd: string | null;
  tarsus_mean: string | null;
  tarsus_sd: string | null;
  notch_f2_mean: string | null;
  notch_f2_sd: string | null;
  inner_foot_mean: string | null;
  inner_foot_sd: string | null;
  quotient_mean: string | null;
  quotient_tolerance_pct: string | null;
  sd_factor: string | null;
  geschlechtsbestimmung_moeglich: boolean | null;
  dj_grossgefiedermauser_moeglich: boolean | null;
}

// One *effective* Artennorm (override ?? default) as served by GET
// /species-norms/ and embedded in the offline bundle. The editor list is built
// from these — every species in force, resolved — and the per-species dialog
// pre-fills from them.
export interface EffectiveSpeciesNorm extends SpeciesNormRules {
  species_id: string;
  species_name: string;
}

// An Organisation's SpeciesNorm **override** row from the Admin CRUD resource
// /species-norm-overrides/. Its own `id` addresses the row for "Auf Standard
// zurücksetzen" (delete). Only overridden (angepasst) species have one.
export interface SpeciesNormOverride extends SpeciesNormRules {
  id: string;
  species_id: string;
  species_name: string;
}

// The write payload for saving (POST upsert) an override: the species plus the
// full set of tunable columns (null = that check off).
export interface SpeciesNormOverridePayload extends SpeciesNormRules {
  species_id: string;
}

// An Organisation's Empfohlene-Ringgröße override (issue #372, ADR 0028) from the
// Admin CRUD resource /species-ring-size-overrides/. A *standalone* value on its
// own table, resolved independently of the whole-row Artennorm: setting or
// clearing it never touches a plausibility check. Its own `id` addresses the row
// for "Auf Standard zurücksetzen" (delete → inherit the global Species.ring_size).
export interface SpeciesRingSizeOverride {
  id: string;
  species_id: string;
  species_name: string;
  ring_size: RingSize;
}

// The write payload for saving (POST upsert) a ring-size override.
export interface SpeciesRingSizeOverridePayload {
  species_id: string;
  ring_size: RingSize;
}
