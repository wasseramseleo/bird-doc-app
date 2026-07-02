import {ChangeDetectionStrategy, Component, inject, signal} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {DatePipe} from '@angular/common';
import {MatButtonModule} from '@angular/material/button';
import {MatIconModule} from '@angular/material/icon';
import {fromEvent} from 'rxjs';

import {ReferenceCacheService} from '../../service/reference-cache.service';

/**
 * The Offline-Bereitschaft indicator (issue #158, PRD #152, see CONTEXT.md):
 * surfaces whether this device is offline-capable and when its reference
 * cache last refreshed, plus a manual "Jetzt aktualisieren" action. Lives in
 * the nav bar, so it is on screen for every authenticated view — its own
 * creation is the "use the app online" trigger that keeps the cache fresh
 * with no separate user action, and it re-fetches again automatically
 * whenever connectivity returns.
 */
@Component({
  selector: 'app-offline-readiness',
  imports: [DatePipe, MatButtonModule, MatIconModule],
  templateUrl: './offline-readiness.html',
  styleUrl: './offline-readiness.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OfflineReadiness {
  private readonly referenceCache = inject(ReferenceCacheService);

  readonly isReady = this.referenceCache.isReady;
  readonly lastRefreshedAt = this.referenceCache.lastRefreshedAt;
  readonly refreshing = signal(false);

  constructor() {
    this.triggerRefresh();

    fromEvent(window, 'online')
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.triggerRefresh());
  }

  refreshNow(): void {
    this.triggerRefresh();
  }

  private triggerRefresh(): void {
    this.refreshing.set(true);
    this.referenceCache.refresh().subscribe(() => this.refreshing.set(false));
  }
}
