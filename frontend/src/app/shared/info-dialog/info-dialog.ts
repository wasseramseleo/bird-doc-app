import {ChangeDetectionStrategy, Component, inject} from '@angular/core';
import {MatButtonModule} from '@angular/material/button';
import {MatDialogModule, MatDialogRef, MAT_DIALOG_DATA} from '@angular/material/dialog';

/**
 * Data contract for {@link InfoDialogComponent} — a purely-informational,
 * single-button modal (PRD #261 / #263). Unlike {@link ConfirmDialogData} it
 * has no confirm/cancel labels: the sole action just acknowledges the message.
 */
export interface InfoDialogData {
  title: string;
  message: string;
  acknowledgeLabel?: string;
}

@Component({
  selector: 'app-info-dialog',
  imports: [MatDialogModule, MatButtonModule],
  templateUrl: './info-dialog.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InfoDialogComponent {
  private readonly dialogRef =
    inject<MatDialogRef<InfoDialogComponent, void>>(MatDialogRef);
  readonly data = inject<InfoDialogData>(MAT_DIALOG_DATA);

  acknowledge(): void {
    this.dialogRef.close();
  }
}
