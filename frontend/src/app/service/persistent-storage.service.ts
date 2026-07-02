import {Injectable, signal} from '@angular/core';

export type PersistentStorageState = 'unsupported' | 'pending' | 'granted' | 'denied';

/**
 * Requests persistent storage from the browser (issue #166, PRD #152) to
 * minimise the risk that the browser evicts a device's offline outbox under
 * storage pressure. `navigator.storage.persist()` is safe to call on every
 * boot: once granted, the browser reports success immediately without
 * re-prompting. The resulting granted/denied state is read by
 * `OfflineReadiness` to surface it in the Offline-Bereitschaft indicator.
 */
@Injectable({providedIn: 'root'})
export class PersistentStorageService {
  readonly state = signal<PersistentStorageState>('pending');

  /** Resolves once the initial persistence request has settled, so callers
   * (and tests) can await a deterministic first state instead of the state
   * defaulting to 'pending'. */
  readonly ready: Promise<void> = this.requestPersistence();

  private async requestPersistence(): Promise<void> {
    if (!navigator.storage?.persist) {
      this.state.set('unsupported');
      return;
    }
    try {
      const granted = await navigator.storage.persist();
      this.state.set(granted ? 'granted' : 'denied');
    } catch (error) {
      console.error('Failed to request persistent storage', error);
      this.state.set('denied');
    }
  }
}
