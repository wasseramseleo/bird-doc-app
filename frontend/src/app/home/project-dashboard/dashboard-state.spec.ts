import { classifyStatsFailure } from './dashboard-state';

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
