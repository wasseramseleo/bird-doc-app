import {ChangeDetectionStrategy, Component, computed, inject, signal} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {FormBuilder, ReactiveFormsModule, Validators} from '@angular/forms';
import {MatButtonModule} from '@angular/material/button';
import {MatButtonToggleModule} from '@angular/material/button-toggle';
import {MatDialogModule, MatDialogRef, MAT_DIALOG_DATA} from '@angular/material/dialog';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatInputModule} from '@angular/material/input';
import {MatSelectModule} from '@angular/material/select';
import {merge} from 'rxjs';

import {Beringer} from '../../models/beringer.model';
import {Mitgliedschaft} from '../../models/mitgliedschaft.model';
import {ScientistCreatePayload} from '../../models/scientist.model';
import {deriveHandle} from '../../shared/util/kuerzel';

// The two ways an Admin closes a gap: verknüpfen an existing no-account Beringer,
// or neu anlegen a fresh one. The caller performs the attach (and, for `create`,
// the preceding open POST) — the dialog only decides the path and gathers input.
export type BeringerAssignResult =
  | {mode: 'link'; beringerId: string}
  | {mode: 'create'; payload: ScientistCreatePayload};

export interface BeringerAssignDialogData {
  // The gap seat (a Mitgliedschaft with handle === null) being reconciled.
  seat: Mitgliedschaft;
  // The no-account Beringer that may be linked to the seat (verknüpfen). The
  // caller supplies them; when empty, only the neu-anlegen path is offered.
  candidates: Beringer[];
}

@Component({
  selector: 'app-beringer-assign-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  templateUrl: './beringer-assign-dialog.html',
  styleUrl: './beringer-assign-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BeringerAssignDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly dialogRef =
    inject<MatDialogRef<BeringerAssignDialogComponent, BeringerAssignResult>>(MatDialogRef);
  readonly data = inject<BeringerAssignDialogData>(MAT_DIALOG_DATA);

  readonly hasCandidates = this.data.candidates.length > 0;

  // Default to verknüpfen when there is an existing Beringer to offer; otherwise
  // the only sensible path is neu anlegen.
  readonly mode = signal<'link' | 'create'>(this.hasCandidates ? 'link' : 'create');

  readonly beringerId = this.fb.control<string | null>(null);

  readonly createForm = this.fb.nonNullable.group({
    first_name: ['', Validators.required],
    last_name: ['', Validators.required],
    handle: [''],
  });

  // Mirrors the beringer-form-dialog: the Kürzel is derived from the name only
  // while the user has not typed one, and is respected from then on.
  private handleSetByUser = false;

  readonly showLinkError = signal<boolean>(false);

  readonly seatLabel = computed(() => `${this.data.seat.username} (${this.data.seat.email})`);

  constructor() {
    this.createForm.controls.handle.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => (this.handleSetByUser = true));

    merge(
      this.createForm.controls.first_name.valueChanges,
      this.createForm.controls.last_name.valueChanges,
    )
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        if (this.handleSetByUser) {
          return;
        }
        const derived = deriveHandle(
          this.createForm.controls.first_name.value,
          this.createForm.controls.last_name.value,
        );
        this.createForm.controls.handle.setValue(derived, {emitEvent: false});
      });
  }

  selectMode(mode: 'link' | 'create'): void {
    this.mode.set(mode);
  }

  submit(): void {
    if (this.mode() === 'link') {
      const id = this.beringerId.value;
      if (!id) {
        this.showLinkError.set(true);
        return;
      }
      this.dialogRef.close({mode: 'link', beringerId: id});
      return;
    }

    if (this.createForm.invalid) {
      this.createForm.markAllAsTouched();
      return;
    }
    this.dialogRef.close({mode: 'create', payload: this.createForm.getRawValue()});
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
