import {
  classifyStatsFailure,
  cumulativeFaenge,
  daysSinceFangtag,
  fangtagRecency,
  formatFangtagDate,
} from './dashboard-state';
import { StatsSeries } from '../../models/project-stats.model';

describe('classifyStatsFailure', () => {
  it('treats a status-0 response as offline (the app\'s "no route to server" signal)', () => {
    // A connectivity failure surfaces as HttpErrorResponse.status === 0 — the
    // same signal AuthService.bootstrap()/DataAccessFacade already read as "no
    // connectivity". The dashboard is online-only (ADR 0017), so this is a
    // needs-connection state, not a broken one.
    expect(classifyStatsFailure(0, true)).toBe('offline');
  });

  it('treats a browser reporting itself offline as offline, whatever the status', () => {
    expect(classifyStatsFailure(null, false)).toBe('offline');
    expect(classifyStatsFailure(500, false)).toBe('offline');
  });

  it('treats a server-side failure while online as a genuine error, not offline', () => {
    expect(classifyStatsFailure(500, true)).toBe('error');
    expect(classifyStatsFailure(404, true)).toBe('error');
  });
});

describe('daysSinceFangtag', () => {
  it('counts whole calendar Tage between the Fangtag and now', () => {
    expect(daysSinceFangtag('2026-07-02', new Date(2026, 6, 4))).toBe(2);
    expect(daysSinceFangtag('2026-07-02', new Date(2026, 6, 2))).toBe(0);
    expect(daysSinceFangtag('2026-07-02', new Date(2026, 7, 1))).toBe(30);
  });

  it('ignores the wall-clock time of day (counts calendar days, not 24h spans)', () => {
    expect(daysSinceFangtag('2026-07-02', new Date(2026, 6, 3, 23, 59))).toBe(1);
    expect(daysSinceFangtag('2026-07-02', new Date(2026, 6, 3, 0, 1))).toBe(1);
  });

  it('never returns a negative count (a Fangtag cannot lie in the future)', () => {
    expect(daysSinceFangtag('2026-07-10', new Date(2026, 6, 2))).toBe(0);
  });
});

describe('formatFangtagDate', () => {
  it('renders a YYYY-MM-DD day de-AT (DD.MM.YYYY), timezone-independent', () => {
    expect(formatFangtagDate('2026-07-02')).toBe('02.07.2026');
    expect(formatFangtagDate('2026-01-09')).toBe('09.01.2026');
  });
});

describe('cumulativeFaenge', () => {
  it('sums all series lines per Fangtag, then runs a cumulative total across the season', () => {
    // Per-Fangtag totals across every line (identified Arten + Übrige): the
    // sparkline shows the season's rising trajectory, not per-day bars — so the
    // running sum, not the daily count.
    const series: StatsSeries = {
      days: ['2026-06-26', '2026-06-28', '2026-07-02'],
      lines: [
        { species_id: 'sp-1', name: 'Mönchsgrasmücke', counts: [10, 12, 12] },
        { species_id: 'sp-2', name: 'Amsel', counts: [5, 8, 8] },
        { species_id: null, name: 'Übrige', counts: [2, 3, 4] },
      ],
    };
    // Daily totals 17, 23, 24 → cumulative 17, 40, 64.
    expect(cumulativeFaenge(series)).toEqual([17, 40, 64]);
  });

  it('is empty for a series with no Fangtage', () => {
    expect(cumulativeFaenge({ days: [], lines: [] })).toEqual([]);
  });

  it('handles a single Fangtag (the running total is just that day)', () => {
    expect(
      cumulativeFaenge({
        days: ['2026-07-02'],
        lines: [{ species_id: 'sp-1', name: 'Amsel', counts: [7] }],
      }),
    ).toEqual([7]);
  });

  it('treats a series with days but no lines as an all-zero trajectory', () => {
    expect(cumulativeFaenge({ days: ['2026-07-01', '2026-07-02'], lines: [] })).toEqual([0, 0]);
  });
});

describe('fangtagRecency', () => {
  it('labels 0/1 Tage as heute/gestern and larger gaps as "vor N Tagen"', () => {
    expect(fangtagRecency('2026-07-02', new Date(2026, 6, 2)).label).toBe('heute');
    expect(fangtagRecency('2026-07-02', new Date(2026, 6, 3)).label).toBe('gestern');
    expect(fangtagRecency('2026-07-02', new Date(2026, 6, 7)).label).toBe('vor 5 Tagen');
  });

  it('marks the chip recent (success tint) at 3 Tagen or less, neutral above', () => {
    expect(fangtagRecency('2026-07-02', new Date(2026, 6, 5)).recent).toBeTrue(); // 3 Tage
    expect(fangtagRecency('2026-07-02', new Date(2026, 6, 6)).recent).toBeFalse(); // 4 Tage
  });

  it('flags a quiet phase only strictly above 14 Tage', () => {
    expect(fangtagRecency('2026-07-02', new Date(2026, 6, 16)).quiet).toBeFalse(); // 14 Tage
    expect(fangtagRecency('2026-07-02', new Date(2026, 6, 17)).quiet).toBeTrue(); // 15 Tage
  });
});
