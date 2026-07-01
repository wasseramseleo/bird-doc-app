import {ChangeDetectionStrategy, Component, inject} from '@angular/core';

import {FormBuilder, ReactiveFormsModule, Validators} from '@angular/forms';
import {MatButtonModule} from '@angular/material/button';
import {MatDialogModule, MatDialogRef, MAT_DIALOG_DATA} from '@angular/material/dialog';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatInputModule} from '@angular/material/input';
import {RingingStation, RingingStationCreatePayload} from '../../models/ringing-station.model';

export interface StationFormDialogData {
  // Present in edit mode; absent when creating a new Station.
  station?: RingingStation;
}

@Component({
  selector: 'app-station-form-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  templateUrl: './station-form-dialog.html',
  styleUrl: './station-form-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StationFormDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly dialogRef =
    inject<MatDialogRef<StationFormDialogComponent, RingingStationCreatePayload>>(MatDialogRef);
  readonly data = inject<StationFormDialogData>(MAT_DIALOG_DATA);

  readonly isEdit = !!this.data.station;

  // Name, Ortskodierung, Breitengrad and Längengrad are required so any Station
  // made in-app always produces valid IWM export rows. Land defaults from the
  // Organisation server-side when left blank; Region is optional. The handle is
  // server-owned and never shown or edited.
  readonly form = this.fb.nonNullable.group({
    name: [this.data.station?.name ?? '', Validators.required],
    place_code: [this.data.station?.place_code ?? '', Validators.required],
    country: [this.data.station?.country ?? ''],
    region: [this.data.station?.region ?? ''],
    latitude: [this.data.station?.latitude ?? '', Validators.required],
    longitude: [this.data.station?.longitude ?? '', Validators.required],
  });

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
