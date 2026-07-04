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
  // Additively added for the KPI row (issue #293), all under the same
  // server-side counting rules: fangtage = distinct Europe/Vienna capture days;
  // faenge = erstfaenge + wiederfaenge. Wiederfang-Anteil and Ø/Fangtag are
  // derived from these client-side.
  fangtage: number;
  erstfaenge: number;
  wiederfaenge: number;
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

// The häufigsten Arten over the selected range (issue #202), ordered by total
// Fänge (desc). Same counting as the card: Ring vernichtet excluded, Aves ignota
// its own labelled entry. Feeds the häufigste-Arten bar chart.
export interface TopSpecies {
  species_id: string;
  name: string;
  count: number;
}

// One line of the per-Fangtag series (issue #203). `counts` aligns
// position-for-position to `StatsSeries.days`. The top-N Arten each get a line
// keyed by their `species_id`; every remaining Art is folded into a single
// `Übrige` line with `species_id: null`.
export interface SeriesLine {
  species_id: string | null;
  name: string;
  counts: number[];
}

// The Top-N-Liniendiagramm data (issue #203): a sparse day axis (only Fangtage
// in range, never a padded calendar) and one counts-line per Art plus Übrige.
export interface StatsSeries {
  // Sparse ISO dates (`YYYY-MM-DD`) — the actual Fangtage, ascending.
  days: string[];
  lines: SeriesLine[];
}

export interface ProjectStats {
  range: ProjectStatsRange;
  totals: ProjectStatsTotals;
  top_species: TopSpecies[];
  series: StatsSeries;
  // Fänge per Europe/Vienna clock hour (0–23) over the range, for the
  // Fangaktivität-nach-Tagesstunde histogram (issue #296). A fixed 24-slot array
  // indexed by hour; an empty range is a fully-zeroed histogram, never missing.
  // Same counting as the rest: Ring vernichtet excluded, Aves ignota included.
  hour_histogram: number[];
  // Null when the range holds no captures (empty payload, no error).
  last_fangtag: LastFangtag | null;
}

export interface ProjectStatsRangeParams {
  preset?: StatsRangePreset;
  from?: string;
  to?: string;
}
