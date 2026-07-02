import {ChangeDetectionStrategy, Component, inject} from '@angular/core';
import {MatButtonModule} from '@angular/material/button';
import {MatIconModule} from '@angular/material/icon';

import {PwaInstallService} from '../../service/pwa-install.service';

/**
 * The guided PWA install affordance (issue #166, PRD #152): a nav-bar button
 * that only exists once the browser has offered its `beforeinstallprompt`
 * event -- Chromium-only, and never fired again once the app is already
 * installed -- so it is naturally absent on unsupported browsers and after
 * install, with no user-agent sniffing.
 */
@Component({
  selector: 'app-pwa-install-button',
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './pwa-install-button.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PwaInstallButton {
  private readonly pwaInstall = inject(PwaInstallService);

  readonly installAvailable = this.pwaInstall.installAvailable;

  install(): void {
    void this.pwaInstall.promptInstall();
  }
}
