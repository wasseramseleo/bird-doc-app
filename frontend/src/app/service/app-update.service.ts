import {computed, inject, Injectable, InjectionToken, signal} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {SwUpdate} from '@angular/service-worker';
import {filter} from 'rxjs';

/**
 * The one place the app reloads itself, injected so a spec can assert what ADR
 * 0032 is mostly about: that nothing *ever* force-reloads. Only a user's own
 * "Jetzt aktualisieren" reaches this.
 */
export const APP_RELOAD = new InjectionToken<() => void>('APP_RELOAD', {
  providedIn: 'root',
  factory: () => () => window.location.reload(),
});

/**
 * Wraps Angular's `SwUpdate` (issue #407, ADR 0032) and exposes its state as
 * signals. **The only place in the app that injects `SwUpdate`.**
 *
 * Running the current Version is the fourth clause of Offline-Bereitschaft (see
 * CONTEXT.md): ngsw downloads a new Version in the background, but an open tab
 * keeps serving its cached bundle until a full reload happens, so a PWA left
 * open across a multi-day ringing trip can run an arbitrarily old Version while
 * the indicator shows a green "Offline bereit". This service supplies the fact;
 * `OfflineReadiness` decides what it means and offers the single control.
 *
 * It only ever *reports*. Adoption is `activateUpdate()` + reload and happens
 * exclusively on the Beringer's own action: there is no timer, no nag, no
 * auto-reload and no reload-on-navigation — a reload mid-capture is data loss
 * with a live bird in hand (there is no autosave; the outbox queues *saved*
 * captures only).
 *
 * `SwUpdate` is optional on purpose: `provideServiceWorker` supplies it only in
 * the real app (`app.config.ts`), never in a TestBed, and it stays disabled in
 * dev. Absent or disabled, every signal here simply stays false — the same
 * "inert where unsupported" shape `PwaInstallService` has on non-Chromium.
 */
@Injectable({providedIn: 'root'})
export class AppUpdateService {
  private readonly swUpdate = inject(SwUpdate, {optional: true});
  private readonly reload = inject(APP_RELOAD);

  private readonly versionReady = signal(false);
  private readonly serverReportedStale = signal(false);
  private readonly brokenCache = signal(false);

  /** ngsw has downloaded a newer Version and is holding it for activation. */
  readonly versionWaiting = this.versionReady.asReadonly();

  /** The service worker reported an unrecoverable state — its cache is broken.
   * Shown, never acted on: Angular's own advice is to reload immediately, and
   * ADR 0032 deliberately ignores it, because offline with a corrupt cache the
   * app would not come back, sealing queued captures behind an app that will
   * not boot. */
  readonly unrecoverable = this.brokenCache.asReadonly();

  /** This device is not running the current Version — either because ngsw is
   * holding a newer one, or because the server said so. */
  readonly versionStale = computed(() => this.versionReady() || this.serverReportedStale());

  constructor() {
    if (!this.swUpdate?.isEnabled) {
      return;
    }

    this.swUpdate.versionUpdates
      .pipe(
        filter((event) => event.type === 'VERSION_READY'),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.versionReady.set(true));

    this.swUpdate.unrecoverable
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.brokenCache.set(true));
  }

  /**
   * The sync path's way to flip Offline-Bereitschaft to "Version veraltet"
   * (ADR 0032 decision 5, ADR 0033 decision 5). A 404 on replay means this
   * bundle is POSTing to an endpoint the server no longer has — better evidence
   * of staleness than ngsw's own check, which a long-lived tab may not have run
   * for days. Issue #409 calls this from the replay path.
   */
  markVersionStale(): void {
    this.serverReportedStale.set(true);
  }

  /** Ask ngsw to look for a new Version. Worth doing on the Beringer's own
   * "Jetzt aktualisieren" — ngsw checks on registration and then not again, so
   * the tab that has been open since Tuesday would otherwise never find out.
   * Never on a timer (ADR 0032 decision 2). */
  async checkForUpdate(): Promise<void> {
    if (!this.swUpdate?.isEnabled) {
      return;
    }
    try {
      await this.swUpdate.checkForUpdate();
    } catch (error) {
      // Offline this simply fails; the indicator keeps saying what it knows.
      console.error('Failed to check for a new Version', error);
    }
  }

  /**
   * Adopt whatever this device is missing: activate a waiting Version, then
   * reload. Also the recovery from an unrecoverable service worker, where there
   * is nothing to activate and the reload alone re-fetches the shell.
   *
   * **Only ever called from the Beringer's own "Jetzt aktualisieren"**, after a
   * dirty capture form has been confirmed away.
   */
  async adopt(): Promise<void> {
    if (!this.versionReady() && !this.brokenCache()) {
      // Nothing to activate and nothing to recover — the server reported drift
      // (`markVersionStale()`) but ngsw has not found the new Version yet.
      // Reloading here would be worse than useless: the tab comes back on the
      // *same* bundle, and `serverReportedStale` does not survive it, so the
      // indicator would re-render a green "Offline bereit" on a bundle the
      // server still 404s — the exact false all-clear ADR 0032 exists to
      // prevent, produced by the control meant to fix it. Staying stale and
      // saying so is the honest outcome; the Version is adopted once a check
      // actually finds it.
      return;
    }
    try {
      if (this.versionReady()) {
        await this.swUpdate?.activateUpdate();
      }
    } catch (error) {
      // A failed activation must not swallow the reload: reloading re-registers
      // ngsw, which is the recovery either way.
      console.error('Failed to activate the waiting Version', error);
    }
    this.reload();
  }
}
