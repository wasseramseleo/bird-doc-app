import {ChangeDetectionStrategy, Component, computed, inject} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {MatButtonModule} from '@angular/material/button';
import {MatIconModule} from '@angular/material/icon';
import {MatSnackBar, MatSnackBarModule} from '@angular/material/snack-bar';
import {fromEvent} from 'rxjs';

import {OutboxService} from '../../service/outbox.service';
import {SyncResult, SyncService} from '../../service/sync.service';

/**
 * The always-visible "N nicht synchronisierte Einträge" indication (issue
 * #160, PRD #152, CONTEXT.md's **nicht synchronisiert** glossary entry):
 * tells the Mitglied at a glance how many captures are durably queued and
 * still waiting to reach the server — shown even at zero, so a Mitglied
 * about to leave for a Station can also confirm nothing is stuck. At zero it
 * flips to a friendly-green "Alle Einträge synchronisiert" (the semantic
 * `--bd-success` token) with a `check_circle` icon, and the manual button is
 * hidden — there is nothing to sync — while staying inside the same
 * `role="status"`/`aria-live="polite"` region so the transition is announced
 * (issue #223). Mounted unconditionally in the nav bar, like
 * `OfflineReadiness`. Driven by `OutboxService`, whose count is restored from
 * IndexedDB on boot so it survives a reload/restart.
 *
 * Also owns synchronisieren (issue #161, CONTEXT.md's **synchronisieren /
 * zuletzt synchronisiert** glossary entry): triggers `SyncService.syncNow()`
 * as soon as it is shown (app start) and again whenever connectivity
 * returns (`window` "online" event) — the same auto-trigger shape
 * `OfflineReadiness` already uses for the reference-cache refresh — plus the
 * manual "Jetzt synchronisieren" action. `OutboxService.dequeue()` (called
 * from within the sync replay) keeps `pendingCount` reactively current, so a
 * successful sync is reflected here with no extra wiring; the snackbar below
 * covers the completion/partial-completion feedback the sync itself has no
 * UI of its own to show. The glossary's **zuletzt synchronisiert** timestamp
 * on the Offline-Bereitschaft indicator itself is PRD #152's Phase 2
 * "readiness-indicator refinements" — out of this tracer-bullet issue's
 * scope.
 */
@Component({
  selector: 'app-outbox-indicator',
  imports: [MatButtonModule, MatIconModule, MatSnackBarModule],
  templateUrl: './outbox-indicator.html',
  styleUrl: './outbox-indicator.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OutboxIndicator {
  private readonly outbox = inject(OutboxService);
  private readonly sync = inject(SyncService);
  private readonly snackBar = inject(MatSnackBar);

  readonly pendingCount = this.outbox.pendingCount;
  readonly syncing = this.sync.syncing;

  // Only reached while pendingCount() > 0 (the template's @else branch), so it
  // never has to phrase the zero case — that is the friendly-green
  // "Alle Einträge synchronisiert" state. Exactly 1 takes the singular.
  readonly pendingLabel = computed(() => {
    const n = this.pendingCount();
    return n === 1
      ? '1 nicht synchronisierter Eintrag'
      : `${n} nicht synchronisierte Einträge`;
  });

  constructor() {
    this.triggerSync();

    fromEvent(window, 'online')
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.triggerSync());
  }

  syncNow(): void {
    this.triggerSync();
  }

  private triggerSync(): void {
    this.sync.syncNow().subscribe((result) => this.showSyncFeedback(result));
  }

  // Nothing eligible was queued (the common case on every app start /
  // reconnect) — silently do nothing rather than announce a no-op sync.
  private showSyncFeedback(result: SyncResult): void {
    if (result.total === 0) {
      return;
    }
    // Entries neither synced nor flagged were left untouched by an interrupted
    // run — they follow automatically on the next attempt. A flagged entry
    // (issue #164) does not: it needs fixing in the form, so it is called out
    // separately rather than folded into the reassuring "der Rest folgt".
    const deferred = result.total - result.synced - result.flagged;
    let message = `${result.synced} von ${result.total} Einträgen synchronisiert`;
    if (result.flagged > 0) {
      message += `, ${result.flagged} mit Fehler markiert`;
    }
    message += deferred > 0 ? ' – der Rest folgt automatisch.' : '.';
    this.snackBar.open(message, 'Schließen', {duration: 3000});
  }
}
