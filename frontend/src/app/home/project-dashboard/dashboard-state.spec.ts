import {
  classifyStatsFailure,
  daysSinceFangtag,
  fangtagRecency,
  formatFangtagDate,
} from './dashboard-state';

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
