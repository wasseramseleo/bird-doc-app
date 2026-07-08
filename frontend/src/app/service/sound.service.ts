import { inject, Injectable, InjectionToken } from '@angular/core';

import { WorkbenchStorageService } from './workbench-storage.service';

/**
 * Creates the `AudioContext` the {@link SoundService} synthesizes through.
 * Injected rather than calling the global `AudioContext` directly so the
 * service is unit-testable with a fake and so context creation stays lazy
 * (the browser's autoplay policy forbids one before a user gesture).
 */
export type AudioContextFactory = () => AudioContext;

export const AUDIO_CONTEXT_FACTORY = new InjectionToken<AudioContextFactory>(
  'AUDIO_CONTEXT_FACTORY',
  {
    providedIn: 'root',
    factory: () => () => new AudioContext(),
  },
);

/**
 * App-wide cue for the Plausibilitätswarnung (PRD #361, issue #363): a short,
 * gentle synthesized „Pling" so the Beringer notices a newly-appeared warning
 * without looking at the screen — both hands can stay on the bird.
 *
 * The sound is fully synthesized via the Web Audio API (an oscillator with a
 * short decay envelope); nothing is bundled or fetched, so it works offline.
 * The `AudioContext` is created lazily on the first `playWarning()` and reused,
 * satisfying the autoplay policy (the first warning always follows a user
 * interaction — a field blur or select change). The cue is per-device
 * mutable through the `soundEnabled` preference and defaults ON: when muted,
 * `playWarning()` is a no-op and the visual safety check is untouched. Any
 * audio failure (blocked, no output device, unsupported browser) is swallowed —
 * the silent Warnung icon and modal must never pay for the audible cue.
 */
@Injectable({ providedIn: 'root' })
export class SoundService {
  private readonly storage = inject(WorkbenchStorageService);
  private readonly createAudioContext = inject(AUDIO_CONTEXT_FACTORY);
  private context: AudioContext | null = null;

  /** Play the warning „Pling" once, unless muted or audio is unavailable. */
  playWarning(): void {
    if (!this.storage.loadSoundEnabled()) {
      return;
    }
    try {
      const ctx = this.ensureContext();
      // Autoplay policy: a context created before the first gesture starts
      // suspended; resume it so the first Pling is actually audible.
      if (ctx.state === 'suspended') {
        void ctx.resume();
      }
      const now = ctx.currentTime;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      // A soft, brief sine chime: near-silent onset → quick swell → short
      // exponential decay. Exponential ramps (never to exactly 0) keep it
      // click-free.
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.2, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.35);
    } catch {
      // Audio blocked/unavailable must never cost the visual safety check.
    }
  }

  private ensureContext(): AudioContext {
    if (!this.context) {
      this.context = this.createAudioContext();
    }
    return this.context;
  }
}
