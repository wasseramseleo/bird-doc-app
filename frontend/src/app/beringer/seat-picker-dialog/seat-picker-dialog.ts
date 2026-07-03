import {ChangeDetectionStrategy, Component, inject} from '@angular/core';
import {FormControl, ReactiveFormsModule, Validators} from '@angular/forms';
import {MatButtonModule} from '@angular/material/button';
import {MatDialogModule, MatDialogRef, MAT_DIALOG_DATA} from '@angular/material/dialog';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatSelectModule} from '@angular/material/select';

import {Mitgliedschaft} from '../../models/mitgliedschaft.model';

export interface SeatPickerDialogData {
  // The Beringer being linked — shown so the Admin knows who they are promoting.
  beringerName: string;
  // Only the eligible seats: same-org Mitgliedschaften whose account is not yet a
  // Beringer (handle === null). The caller filters; the dialog only picks.
  seats: Mitgliedschaft[];
}

@Component({
  selector: 'app-seat-picker-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatSelectModule,
  ],
  templateUrl: './seat-picker-dialog.html',
  styleUrl: './seat-picker-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SeatPickerDialogComponent {
  private readonly dialogRef =
    inject<MatDialogRef<SeatPickerDialogComponent, string>>(MatDialogRef);
  readonly data = inject<SeatPickerDialogData>(MAT_DIALOG_DATA);

  readonly seatId = new FormControl<string | null>(null, {validators: [Validators.required]});

  submit(): void {
    if (this.seatId.invalid || !this.seatId.value) {
      this.seatId.markAsTouched();
      return;
    }
    this.dialogRef.close(this.seatId.value);
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
