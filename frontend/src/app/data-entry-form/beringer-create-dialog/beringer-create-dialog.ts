import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { merge } from 'rxjs';

import { deriveHandle } from '../../shared/util/kuerzel';

export interface BeringerCreateDialogData {
  /** The Kürzel the user typed that matched no Beringer; pre-fills the field. */
  handle: string;
}

export interface BeringerCreateDialogResult {
  first_name: string;
  last_name: string;
  handle: string;
}

@Component({
  selector: 'app-beringer-create-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule
],
  templateUrl: './beringer-create-dialog.html',
  styleUrl: './beringer-create-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BeringerCreateDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly dialogRef =
    inject<MatDialogRef<BeringerCreateDialogComponent, BeringerCreateDialogResult>>(MatDialogRef);
  readonly data = inject<BeringerCreateDialogData>(MAT_DIALOG_DATA);

  readonly form = this.fb.nonNullable.group({
    first_name: ['', Validators.required],
    last_name: ['', Validators.required],
    handle: [this.data.handle ?? ''],
  });

  // Derive the Kürzel from the names only while it has not been set by hand: a
  // pre-filled (typed) value, or one the user edits, is respected from then on.
  private handleSetByUser = !!this.data.handle;

  constructor() {
    this.form.controls.handle.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => (this.handleSetByUser = true));

    merge(this.form.controls.first_name.valueChanges, this.form.controls.last_name.valueChanges)
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        if (this.handleSetByUser) {
          return;
        }
        const derived = deriveHandle(
          this.form.controls.first_name.value,
          this.form.controls.last_name.value,
        );
        this.form.controls.handle.setValue(derived, { emitEvent: false });
      });
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.dialogRef.close(this.form.getRawValue());
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
