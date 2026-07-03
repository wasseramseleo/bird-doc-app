import {ChangeDetectionStrategy, Component, inject} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';

import {FormBuilder, ReactiveFormsModule, Validators} from '@angular/forms';
import {MatButtonModule} from '@angular/material/button';
import {MatDialogModule, MatDialogRef, MAT_DIALOG_DATA} from '@angular/material/dialog';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatInputModule} from '@angular/material/input';
import {merge} from 'rxjs';

import {Beringer} from '../../models/beringer.model';
import {ScientistCreatePayload} from '../../models/scientist.model';
import {deriveHandle} from '../../shared/util/kuerzel';

export interface BeringerFormDialogData {
  // Present in edit mode; absent when adding a new Beringer.
  beringer?: Beringer;
}

@Component({
  selector: 'app-beringer-form-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  templateUrl: './beringer-form-dialog.html',
  styleUrl: './beringer-form-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BeringerFormDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly dialogRef =
    inject<MatDialogRef<BeringerFormDialogComponent, ScientistCreatePayload>>(MatDialogRef);
  readonly data = inject<BeringerFormDialogData>(MAT_DIALOG_DATA);

  readonly isEdit = !!this.data.beringer;

  readonly form = this.fb.nonNullable.group({
    first_name: [this.data.beringer?.first_name ?? '', Validators.required],
    last_name: [this.data.beringer?.last_name ?? '', Validators.required],
    handle: [this.data.beringer?.handle ?? ''],
  });

  // The Kürzel is user-facing and editable (it flows into the IWM export). It is
  // derived from the name only while it has not been set — a value already on the
  // Beringer (edit mode) or one the user types is respected from then on and
  // never auto-rewritten when the name changes (issue #207).
  private handleSetByUser = !!this.data.beringer?.handle;

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
        this.form.controls.handle.setValue(derived, {emitEvent: false});
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
