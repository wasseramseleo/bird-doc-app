import {ComponentFixture, TestBed} from '@angular/core/testing';

import {PwaInstallButton} from './pwa-install-button';
import {PwaInstallService} from '../../service/pwa-install.service';

function fireBeforeInstallPrompt(
  prompt = jasmine.createSpy('prompt').and.resolveTo(),
): void {
  const event = new Event('beforeinstallprompt', {cancelable: true});
  Object.assign(event, {
    prompt,
    userChoice: Promise.resolve({outcome: 'accepted', platform: 'web'}),
  });
  window.dispatchEvent(event);
}

function setup(): {fixture: ComponentFixture<PwaInstallButton>} {
  TestBed.configureTestingModule({imports: [PwaInstallButton]});
  const fixture = TestBed.createComponent(PwaInstallButton);
  fixture.detectChanges();
  return {fixture};
}

describe('PwaInstallButton', () => {
  it('is absent when no guided install is available (e.g. non-Chromium)', () => {
    const {fixture} = setup();

    expect(fixture.nativeElement.querySelector('.pwa-install')).toBeNull();
  });

  it('appears once the browser offers a guided install (beforeinstallprompt)', () => {
    const {fixture} = setup();

    fireBeforeInstallPrompt();
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('.pwa-install') as HTMLButtonElement;
    expect(button).withContext('guided install button').not.toBeNull();
    expect(button.textContent).toContain('App installieren');
  });

  it('replays the captured browser prompt on click and then hides itself again', () => {
    const {fixture} = setup();
    const prompt = jasmine.createSpy('prompt').and.resolveTo();
    fireBeforeInstallPrompt(prompt);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('.pwa-install') as HTMLButtonElement;
    button.click();
    fixture.detectChanges();

    expect(prompt).toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.pwa-install')).toBeNull();
  });

  it('delegates to PwaInstallService.promptInstall() on click', () => {
    const {fixture} = setup();
    fireBeforeInstallPrompt();
    fixture.detectChanges();
    const service = TestBed.inject(PwaInstallService);
    const promptInstall = spyOn(service, 'promptInstall').and.resolveTo();

    const button = fixture.nativeElement.querySelector('.pwa-install') as HTMLButtonElement;
    button.click();

    expect(promptInstall).toHaveBeenCalled();
  });
});
