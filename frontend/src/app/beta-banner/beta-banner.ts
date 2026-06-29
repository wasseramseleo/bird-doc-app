import {ChangeDetectionStrategy, Component, inject, signal} from '@angular/core';
import {MatButtonModule} from '@angular/material/button';
import {MatIconModule} from '@angular/material/icon';
import {WorkbenchStorageService} from '../service/workbench-storage.service';

/**
 * One-time, dismissible beta notice. It greets a user until they dismiss it;
 * the dismissal is persisted (via {@link WorkbenchStorageService}) so the
 * banner never nags again on a later login.
 */
@Component({
  selector: 'app-beta-banner',
  imports: [MatIconModule, MatButtonModule],
  templateUrl: './beta-banner.html',
  styleUrl: './beta-banner.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BetaBanner {
  private readonly storage = inject(WorkbenchStorageService);

  readonly visible = signal(!this.storage.loadBetaBannerDismissed());

  dismiss(): void {
    this.storage.saveBetaBannerDismissed();
    this.visible.set(false);
  }
}
