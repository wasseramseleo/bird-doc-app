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
