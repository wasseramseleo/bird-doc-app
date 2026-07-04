import {InjectionToken} from '@angular/core';

import {StatsSeries} from '../../models/project-stats.model';

// The Fänge-KPI-Tile sparkline series (issue #299): the season's *cumulative*
// Fänge trajectory, derived client-side from the already-served per-Fangtag
// series — no backend change (ADR 0017). Each entry is the running total of all
// Fänge up to and including that Fangtag: for every day it sums every series line
// (the identified Arten plus the folded Übrige), then accumulates across the
// season, so the sparkline reads as a rising trajectory rather than per-day bars.
// One value per Fangtag, aligned to `series.days`; an empty series yields [].
export function cumulativeFaenge(series: StatsSeries): number[] {
  let running = 0;
  return series.days.map((_day, index) => {
    const dayTotal = series.lines.reduce((sum, line) => sum + (line.counts[index] ?? 0), 0);
    running += dayTotal;
    return running;
  });
}

// The dashboard's reference "now", injected so the recency chip and Ruhige-Phase
// threshold are deterministic in tests. Defaults to the real wall clock; a spec
// overrides it with a fixed Date to pin how many Tage ago the last Fangtag lies.
export const DASHBOARD_NOW = new InjectionToken<() => Date>('DASHBOARD_NOW', {
  providedIn: 'root',
  factory: () => () => new Date(),
});

// The honest recency of the last Fangtag (issue #295). One small value the strip
// binds directly: how many whole Tage ago it was, the de-AT chip label, whether
// that counts as *recent* (success-tinted chip, ≤ 3 Tage) and whether it is old
// enough to warrant the calm Ruhige-Phase note (> 14 Tage).
export interface FangtagRecency {
  daysAgo: number;
  label: string;
  recent: boolean;
  quiet: boolean;
}

// Whole calendar Tage between a Fangtag day (`YYYY-MM-DD`, Europe/Vienna) and
// `now`. Computed on the date parts via `Date.UTC`, so it never drifts a day
// across a timezone offset or DST boundary the way `new Date('YYYY-MM-DD')`
// would. Never negative — a Fangtag cannot lie in the future.
export function daysSinceFangtag(fangtagDate: string, now: Date): number {
  const [y, m, d] = fangtagDate.split('-').map(Number);
  const fangtag = Date.UTC(y, m - 1, d);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((today - fangtag) / 86_400_000));
}

// The Fangtag day (`YYYY-MM-DD`) rendered de-AT (`DD.MM.YYYY`). Reformatted on
// the string parts so it is timezone-independent (no Date parsing at all).
export function formatFangtagDate(fangtagDate: string): string {
  const [y, m, d] = fangtagDate.split('-');
  return `${d}.${m}.${y}`;
}

// Resolve a Fangtag day + reference `now` into its recency. The chip is *always*
// shown so the reader is never misled about how current the numbers are: success
// tint at ≤ 3 Tagen, neutral otherwise. The Ruhige-Phase note follows the strict
// > 14 Tage rule (so exactly 14 Tage is still "normal, not quiet").
export function fangtagRecency(fangtagDate: string, now: Date): FangtagRecency {
  const daysAgo = daysSinceFangtag(fangtagDate, now);
  const label = daysAgo === 0 ? 'heute' : daysAgo === 1 ? 'gestern' : `vor ${daysAgo} Tagen`;
  return {daysAgo, label, recent: daysAgo <= 3, quiet: daysAgo > 14};
}

// Which terminal state the dashboard shows once a stats fetch settles. `offline`
// and `error` are kept distinct on purpose (issue #204): the dashboard is
// online-only (ADR 0017), so losing the network is a *needs-connection* state
// the field Beringer can act on, not a sign the analysis view is broken.
export type DashboardFailure = 'offline' | 'error';

/**
 * Classify a failed stats fetch as an offline (needs-connection) state or a
 * genuine error. A connectivity failure surfaces as `HttpErrorResponse.status
 * === 0` — the same "no route to server" signal `AuthService.bootstrap()` and
 * `DataAccessFacadeService` already read as "no connectivity" — and a browser
 * reporting itself offline (`navigator.onLine === false`) is offline whatever
 * the status. Every other failure (a reachable server returning 4xx/5xx) is a
 * real error.
 *
 * Pure so it can be unit-tested on plain inputs; the component supplies
 * `err.status` and `navigator.onLine`.
 */
export function classifyStatsFailure(
  status: number | null,
  online: boolean,
): DashboardFailure {
  if (!online || status === 0) {
    return 'offline';
  }
  return 'error';
}
