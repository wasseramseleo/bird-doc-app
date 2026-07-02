import {ChangeDetectionStrategy, Component, inject} from '@angular/core';
import {MatIconModule} from '@angular/material/icon';

import {ConnectivityService} from '../../core/offline/connectivity';

/**
 * The persistent "Offline" indication (issue #159, PRD #152, CONTEXT.md's
 * **Offline** glossary entry): tells the Mitglied at a glance whether an
 * entry recorded right now is being saved to the server or only locally.
 * Mounted unconditionally in the nav bar — like `OfflineReadiness`, its
 * *presence* is constant, but it renders nothing while the app has
 * connectivity; the normal connected state carries no special indication of
 * its own. Driven by `ConnectivityService`, which `DataAccessFacadeService`
 * updates from the outcome of its own reads.
 */
@Component({
  selector: 'app-offline-indicator',
  imports: [MatIconModule],
  templateUrl: './offline-indicator.html',
  styleUrl: './offline-indicator.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OfflineIndicator {
  private readonly connectivity = inject(ConnectivityService);

  readonly isOffline = this.connectivity.isOffline;
}
