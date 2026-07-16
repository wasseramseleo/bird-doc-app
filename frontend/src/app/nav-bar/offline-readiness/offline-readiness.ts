import {ChangeDetectionStrategy, Component, computed, inject, signal} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {DatePipe} from '@angular/common';
import {MatButtonModule} from '@angular/material/button';
import {MatIconModule} from '@angular/material/icon';
import {firstValueFrom, fromEvent} from 'rxjs';

import {ReferenceCacheService} from '../../service/reference-cache.service';
import {PersistentStorageService} from '../../service/persistent-storage.service';
import {AppUpdateService} from '../../service/app-update.service';
import {UnsavedChangesService} from '../../service/unsaved-changes.service';
import {ConnectivityService} from '../../core/offline/connectivity';

/** Why this device is not offline bereit. The indicator carries several
 * distinct reasons now, so it has to say *which* — otherwise it is a light that
 * means "something" (ADR 0032). */
export type NotReadyReason = 'unrecoverable' | 'version-stale' | 'cache';

/**
 * The Offline-Bereitschaft indicator (issue #158, PRD #152, see CONTEXT.md):
 * surfaces whether this device is offline-capable and when its reference
 * cache last refreshed, plus a manual "Jetzt aktualisieren" action. Lives in
 * the nav bar, so it is on screen for every authenticated view — its own
 * creation is the "use the app online" trigger that keeps the cache fresh
 * with no separate user action, and it re-fetches again automatically
 * whenever connectivity returns.
 *
 * Also surfaces the granted/denied state of the browser's persistent-storage
 * request (issue #166): the domain glossary's Offline-Bereitschaft explicitly
 * includes "its storage is protected from eviction", so this indicator is
 * where that state belongs.
 *
 * Issue #407 (ADR 0032) adds the fourth clause: **running the current Version**.
 * A stale Version makes a device *not* offline bereit however fresh its cache —
 * otherwise this would render a green "Offline bereit" to a device on a
 * two-release-old bundle at the exact moment the Beringer asks the question the
 * indicator exists to answer: *am I good to leave for the Station?* No new
 * banner and no new term: one question, one widget, one control.
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
  private readonly persistentStorage = inject(PersistentStorageService);
  private readonly appUpdate = inject(AppUpdateService);
  private readonly unsavedChanges = inject(UnsavedChangesService);
  private readonly connectivity = inject(ConnectivityService);

  readonly lastRefreshedAt = this.referenceCache.lastRefreshedAt;
  readonly persistenceState = this.persistentStorage.state;
  readonly refreshing = signal(false);

  // The unrecoverable service worker outranks a stale Version, which outranks a
  // cache still warming up: the indicator names the worst thing it knows.
  readonly notReadyReason = computed<NotReadyReason | null>(() => {
    if (this.appUpdate.unrecoverable()) return 'unrecoverable';
    if (this.appUpdate.versionStale()) return 'version-stale';
    if (!this.referenceCache.isReady()) return 'cache';
    return null;
  });

  readonly isReady = computed(() => this.notReadyReason() === null);

  readonly statusLabel = computed(() => {
    switch (this.notReadyReason()) {
      case 'unrecoverable':
        return 'App-Cache beschädigt';
      case 'version-stale':
        return 'Version veraltet';
      case 'cache':
        return 'Cache wird vorbereitet …';
      default:
        return 'Offline bereit';
    }
  });

  // Same headline for both ways a stale Version is discovered — it is one fact —
  // but the hint says what to expect, since only a waiting Version adopts in a
  // single click.
  readonly statusHint = computed(() => {
    switch (this.notReadyReason()) {
      case 'unrecoverable':
        return 'Der Offline-Cache ist beschädigt. „Jetzt aktualisieren" lädt die App neu, sobald wieder eine Verbindung besteht.';
      case 'version-stale':
        return this.appUpdate.versionWaiting()
          ? 'Eine neue Version steht bereit. „Jetzt aktualisieren" übernimmt sie.'
          : 'Der Server meldet, dass diese Version veraltet ist. „Jetzt aktualisieren" holt die neue Version.';
      case 'cache':
        return 'Die Referenzdaten für den Offline-Betrieb werden geladen.';
      default:
        return 'Dieses Gerät ist für den Offline-Betrieb bereit.';
    }
  });

  constructor() {
    this.triggerRefresh();

    fromEvent(window, 'online')
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.triggerRefresh());
  }

  /**
   * "Jetzt aktualisieren" — the single control that makes this device current in
   * every sense (ADR 0032 decision 1). Its two jobs separate in **one**
   * direction: the reference-cache top-up runs unconditionally, because it is
   * safe and idempotent — declining a Version must never cost the Beringer his
   * cache refresh. Only the Version half is coupled to the confirmation.
   */
  async refreshNow(): Promise<void> {
    this.triggerRefresh();
    await this.appUpdate.checkForUpdate();
    await this.adoptIfOffered();
  }

  private async adoptIfOffered(): Promise<void> {
    if (!this.adoptionOffered()) {
      return;
    }
    // A pristine form adopts straight away; a dirty one is asked about first,
    // and a "no" simply leaves the Version waiting — it will still be waiting
    // after the bird is released.
    if (await firstValueFrom(this.unsavedChanges.confirmDiscard())) {
      await this.appUpdate.adopt();
    }
  }

  private adoptionOffered(): boolean {
    if (this.appUpdate.unrecoverable()) {
      // ADR 0032 decision 4: the recovery reload is offered **only when online**.
      // Offline the service worker cannot serve index.html and there is no
      // network to fetch it from — the app would not come back, and the queued
      // captures would survive in IndexedDB but sealed behind an app that will
      // not boot. A degraded-but-working app must not become a dead one at the
      // exact moment it cannot be fixed.
      return this.isOnline();
    }
    return this.appUpdate.versionStale();
  }

  // Conservative on purpose: either source claiming no network is enough to
  // withhold the reload above.
  private isOnline(): boolean {
    return navigator.onLine && !this.connectivity.isOffline();
  }

  private triggerRefresh(): void {
    this.refreshing.set(true);
    this.referenceCache.refresh().subscribe(() => this.refreshing.set(false));
  }
}
