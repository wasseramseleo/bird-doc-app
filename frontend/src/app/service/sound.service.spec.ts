import { TestBed } from '@angular/core/testing';

import { AUDIO_CONTEXT_FACTORY, SoundService } from './sound.service';
import { WorkbenchStorageService } from './workbench-storage.service';

// A hand-rolled fake of just the Web Audio surface SoundService touches, so the
// spec asserts observable behaviour (an oscillator is created and started)
// without ever constructing a real AudioContext or emitting sound.
interface FakeOscillator {
  type: string;
  frequency: { setValueAtTime: jasmine.Spy };
  connect: jasmine.Spy;
  start: jasmine.Spy;
  stop: jasmine.Spy;
}

function makeFakeContext(state: AudioContextState = 'running') {
  const oscillator: FakeOscillator = {
    type: '',
    frequency: { setValueAtTime: jasmine.createSpy('frequency.setValueAtTime') },
    connect: jasmine.createSpy('oscillator.connect'),
    start: jasmine.createSpy('oscillator.start'),
    stop: jasmine.createSpy('oscillator.stop'),
  };
  const gain = {
    gain: {
      setValueAtTime: jasmine.createSpy('gain.setValueAtTime'),
      exponentialRampToValueAtTime: jasmine.createSpy('gain.exponentialRampToValueAtTime'),
    },
    connect: jasmine.createSpy('gain.connect'),
  };
  const context = {
    state,
    currentTime: 0,
    destination: {},
    resume: jasmine.createSpy('resume').and.resolveTo(undefined),
    createOscillator: jasmine.createSpy('createOscillator').and.returnValue(oscillator),
    createGain: jasmine.createSpy('createGain').and.returnValue(gain),
  };
  return { context, oscillator, gain };
}

describe('SoundService', () => {
  let factory: jasmine.Spy;
  let fake: ReturnType<typeof makeFakeContext>;

  function configure(state: AudioContextState = 'running'): SoundService {
    fake = makeFakeContext(state);
    factory = jasmine.createSpy('audioContextFactory').and.returnValue(fake.context);
    TestBed.configureTestingModule({
      providers: [{ provide: AUDIO_CONTEXT_FACTORY, useValue: factory }],
    });
    return TestBed.inject(SoundService);
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('no-ops when the sound preference is off (no AudioContext, no oscillator)', () => {
    const service = configure();
    TestBed.inject(WorkbenchStorageService).saveSoundEnabled(false);

    service.playWarning();

    expect(factory).not.toHaveBeenCalled();
    expect(fake.context.createOscillator).not.toHaveBeenCalled();
  });

  it('creates and starts an oscillator when the preference is on', () => {
    const service = configure();

    service.playWarning();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(fake.context.createOscillator).toHaveBeenCalledTimes(1);
    expect(fake.oscillator.start).toHaveBeenCalledTimes(1);
    expect(fake.oscillator.stop).toHaveBeenCalledTimes(1);
  });

  it('creates the AudioContext lazily and reuses it across plays', () => {
    const service = configure();

    service.playWarning();
    service.playWarning();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(fake.context.createOscillator).toHaveBeenCalledTimes(2);
  });

  it('resumes a suspended AudioContext (autoplay policy) before playing', () => {
    const service = configure('suspended');

    service.playWarning();

    expect(fake.context.resume).toHaveBeenCalled();
    expect(fake.oscillator.start).toHaveBeenCalledTimes(1);
  });

  it('never throws when the AudioContext factory fails (visual check must not pay for audio)', () => {
    factory = jasmine.createSpy('audioContextFactory').and.throwError('no audio device');
    TestBed.configureTestingModule({
      providers: [{ provide: AUDIO_CONTEXT_FACTORY, useValue: factory }],
    });
    const service = TestBed.inject(SoundService);

    expect(() => service.playWarning()).not.toThrow();
  });
});
