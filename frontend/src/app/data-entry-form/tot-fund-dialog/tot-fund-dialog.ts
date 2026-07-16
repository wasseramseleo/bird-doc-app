import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

export interface TotFundDialogData {
  /**
   * The Todesumstände to pre-fill — parsed out of an existing capture's composed
   * Bemerkung when a Tot-Fund is edited (ADR 0026). Empty for a fresh Tot-Fund.
   */
  umstaende: string;
}

/**
 * The Tot-Fund popup (ADR 0026): it asks for the Todesumstände, which is required.
 * On confirm it returns the entered text as a plain string; the caller composes
 * the Bemerkung `Totfund; Umstände: <Eingabe>` from it. Cancelling returns
 * `undefined`, leaving the capture un-marked. The Todesumstände is never a field
 * of its own — it lives only inside the composed Bemerkung.
 */
@Component({
  selector: 'app-tot-fund-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  templateUrl: './tot-fund-dialog.html',
  styleUrl: './tot-fund-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TotFundDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly dialogRef =
    inject<MatDialogRef<TotFundDialogComponent, string>>(MatDialogRef);
  readonly data = inject<TotFundDialogData>(MAT_DIALOG_DATA);

  readonly form = this.fb.nonNullable.group({
    umstaende: [this.data?.umstaende ?? '', Validators.required],
  });

  confirm(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.dialogRef.close(this.form.controls.umstaende.value.trim());
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
