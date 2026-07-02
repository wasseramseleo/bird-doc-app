import {ChangeDetectionStrategy, Component, inject} from '@angular/core';
import {MatIconModule} from '@angular/material/icon';

import {OutboxService} from '../../service/outbox.service';

/**
 * The always-visible "N nicht synchronisierte Einträge" indication (issue
 * #160, PRD #152, CONTEXT.md's **nicht synchronisiert** glossary entry):
 * tells the Mitglied at a glance how many captures are durably queued and
 * still waiting to reach the server — shown even at zero, so a Mitglied
 * about to leave for a Station can also confirm nothing is stuck. Mounted
 * unconditionally in the nav bar, like `OfflineReadiness`. Driven by
 * `OutboxService`, whose count is restored from IndexedDB on boot so it
 * survives a reload/restart.
 */
@Component({
  selector: 'app-outbox-indicator',
  imports: [MatIconModule],
  templateUrl: './outbox-indicator.html',
  styleUrl: './outbox-indicator.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OutboxIndicator {
  private readonly outbox = inject(OutboxService);

  readonly pendingCount = this.outbox.pendingCount;
}
