// A Zentrale (EURING ringing scheme) — global reference data like Species,
// never tenant-scoped (ADR 0019). The read shape returned by /centrals/ and
// nested inside a Ring on a capture GET. `scheme_code` is the globally-unique
// EURING code (e.g. AUW = Österreichische Vogelwarte, SKB = Slowakei
// Bratislava); the flat write payload and every comparison key on it, never the
// server UUID.
export interface Central {
  id: string;
  scheme_code: string;
  name: string;
  country: string;
}

// The home scheme code — the Österreichische Vogelwarte.
export const AUW_SCHEME_CODE = 'AUW';

// The Projekt-Zentrale. `Project.central` is modelled but not yet surfaced as a
// per-Projekt selector (ADR 0019, design brief §4): today every Projekt-Zentrale
// is AUW, so the capture form treats AUW as THE Projekt-Zentrale — the default a
// domestic capture carries, the value the Zentrale field is forced to on
// Erstfang/Ring-vernichtet, and the value it resets to after each save. Because
// the flat write payload and the "is this the Projekt-Zentrale?" comparison key
// on `scheme_code`, the frontend never needs AUW's real server id.
export const PROJEKT_ZENTRALE: Central = {
  id: '',
  scheme_code: AUW_SCHEME_CODE,
  name: 'Österreichische Vogelwarte',
  country: 'Österreich',
};
