import {Injectable, signal} from '@angular/core';

/**
 * Whether the app currently has a route to the server (issue #159, PRD #152).
 * Driven by the outcome of the data-access facade's own read attempts —
 * `DataAccessFacadeService` marks the app offline exactly when a read falls
 * back to the IndexedDB cache after a connectivity failure
 * (`HttpErrorResponse.status === 0`, the same signal `AuthService.bootstrap()`
 * already treats as "no connectivity" — issue #156), and marks it online again
 * on the next read that reaches the server. Powers the persistent "Offline"
 * indicator (see CONTEXT.md's **Offline** glossary entry): "Offline –
 * Einträge werden lokal gespeichert".
 */
@Injectable({providedIn: 'root'})
export class ConnectivityService {
  private readonly offline = signal(false);
  readonly isOffline = this.offline.asReadonly();

  markOnline(): void {
    this.offline.set(false);
  }

  markOffline(): void {
    this.offline.set(true);
  }
}
