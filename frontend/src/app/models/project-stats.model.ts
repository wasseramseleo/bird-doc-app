// Projekt-Dashboard stats (PRD #199, issue #201). Mirrors the read-only
// `GET /api/birds/projects/{id}/stats/` composite payload. All counting
// semantics live server-side (ADR 0017); the client only renders these numbers.

export type StatsRangePreset = 'week' | 'month' | 'year' | 'all';

export interface ProjectStatsRange {
  // ISO dates (`YYYY-MM-DD`); `from` may be null for an open lower bound (`all`).
  from: string | null;
  to: string | null;
  // Null when the range was given as explicit from/to rather than a preset.
  preset: StatsRangePreset | null;
}

export interface ProjectStatsTotals {
  faenge: number;
  artenzahl: number;
}

export interface HaeufigsteArt {
  species_id: string;
  name: string;
  count: number;
}

export interface StrongestHour {
  // Vienna clock hour (0–23) with the most captures on the last Fangtag.
  hour: number;
  count: number;
}

export interface FangtagTrend {
  // The immediately-preceding *data-bearing* Fangtag (never an empty calendar
  // day); null when the last Fangtag is the only one in range.
  previous_fangtag: string | null;
  previous_faenge: number | null;
  delta: number;
}

export interface LastFangtag {
  date: string;
  faenge: number;
  trend: FangtagTrend;
  haeufigste_art: HaeufigsteArt | null;
  strongest_hour: StrongestHour | null;
}

export interface ProjectStats {
  range: ProjectStatsRange;
  totals: ProjectStatsTotals;
  // Null when the range holds no captures (empty payload, no error).
  last_fangtag: LastFangtag | null;
}

export interface ProjectStatsRangeParams {
  preset?: StatsRangePreset;
  from?: string;
  to?: string;
}
