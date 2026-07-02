import {TestBed} from '@angular/core/testing';

import {PwaInstallService} from './pwa-install.service';

interface FakePrompt {
  event: Event;
  prompt: jasmine.Spy;
}

function fireBeforeInstallPrompt(outcome: 'accepted' | 'dismissed' = 'accepted'): FakePrompt {
  const event = new Event('beforeinstallprompt', {cancelable: true});
  const prompt = jasmine.createSpy('prompt').and.resolveTo();
  Object.assign(event, {
    prompt,
    userChoice: Promise.resolve({outcome, platform: 'web'}),
  });
  window.dispatchEvent(event);
  return {event, prompt};
}

describe('PwaInstallService', () => {
  it('is not available until the browser fires beforeinstallprompt (e.g. non-Chromium)', () => {
    const service = TestBed.inject(PwaInstallService);

    expect(service.installAvailable()).toBeFalse();
  });

  it('becomes available once the browser fires beforeinstallprompt', () => {
    const service = TestBed.inject(PwaInstallService);

    fireBeforeInstallPrompt();

    expect(service.installAvailable()).toBeTrue();
  });

  it('suppresses the browser-native mini-infobar by calling preventDefault', () => {
    TestBed.inject(PwaInstallService);
    const event = new Event('beforeinstallprompt', {cancelable: true});
    Object.assign(event, {
      prompt: jasmine.createSpy('prompt').and.resolveTo(),
      userChoice: Promise.resolve({outcome: 'accepted', platform: 'web'}),
    });
    spyOn(event, 'preventDefault').and.callThrough();

    window.dispatchEvent(event);

    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('promptInstall() replays the captured deferred prompt and clears availability', async () => {
    const service = TestBed.inject(PwaInstallService);
    const {prompt} = fireBeforeInstallPrompt();

    await service.promptInstall();

    expect(prompt).toHaveBeenCalled();
    expect(service.installAvailable()).toBeFalse();
  });

  it('does nothing when promptInstall() is called with no captured prompt', async () => {
    const service = TestBed.inject(PwaInstallService);

    await expectAsync(service.promptInstall()).toBeResolved();
    expect(service.installAvailable()).toBeFalse();
  });

  it('resets availability when the app is installed (appinstalled event)', () => {
    const service = TestBed.inject(PwaInstallService);
    fireBeforeInstallPrompt();
    expect(service.installAvailable()).toBeTrue();

    window.dispatchEvent(new Event('appinstalled'));

    expect(service.installAvailable()).toBeFalse();
  });
});
