import {Injectable, signal} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {fromEvent} from 'rxjs';

/**
 * The Chromium `beforeinstallprompt` event, deferred so the app can offer a
 * guided install affordance on its own terms instead of the browser's
 * spontaneous mini-infobar (issue #166, PRD #152).
 */
export interface BeforeInstallPromptEvent extends Event {
  readonly userChoice: Promise<{outcome: 'accepted' | 'dismissed'; platform: string}>;
  prompt(): Promise<void>;
}

/**
 * Captures the browser's install prompt so the app can offer a guided PWA
 * install affordance (issue #166, PRD #152) instead of relying on the
 * browser's own spontaneous UI. Chromium-only: `beforeinstallprompt` never
 * fires on Firefox/Safari, so `installAvailable` simply never becomes true
 * there -- exactly the "absent where unsupported" behaviour the affordance
 * needs, with no user-agent sniffing required. Also resets once the app is
 * actually installed (`appinstalled`), since the browser won't re-fire the
 * prompt event for an already-installed PWA.
 */
@Injectable({providedIn: 'root'})
export class PwaInstallService {
  readonly installAvailable = signal(false);

  private deferredPrompt: BeforeInstallPromptEvent | null = null;

  constructor() {
    fromEvent<Event>(window, 'beforeinstallprompt')
      .pipe(takeUntilDestroyed())
      .subscribe((event) => {
        // Suppress the browser's own mini-infobar; the app decides when to
        // show its guided install affordance instead.
        event.preventDefault();
        this.deferredPrompt = event as BeforeInstallPromptEvent;
        this.installAvailable.set(true);
      });

    fromEvent(window, 'appinstalled')
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        this.deferredPrompt = null;
        this.installAvailable.set(false);
      });
  }

  /** Replays the captured browser prompt. A no-op if no prompt is available
   * (e.g. called twice, or before `beforeinstallprompt` ever fired). */
  async promptInstall(): Promise<void> {
    const deferredPrompt = this.deferredPrompt;
    if (!deferredPrompt) return;

    this.deferredPrompt = null;
    this.installAvailable.set(false);
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
  }
}
