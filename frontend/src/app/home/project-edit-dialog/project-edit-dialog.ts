import {ChangeDetectionStrategy, Component, inject, signal} from '@angular/core';

import {FormBuilder, ReactiveFormsModule, Validators} from '@angular/forms';
import {MatButtonModule} from '@angular/material/button';
import {MatCheckboxModule} from '@angular/material/checkbox';
import {MatDialogModule, MatDialogRef, MAT_DIALOG_DATA} from '@angular/material/dialog';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatInputModule} from '@angular/material/input';
import {MatSelectModule} from '@angular/material/select';
import {PROJEKTTYP_OPTIONS, Project, Projekttyp} from '../../models/project.model';
import {RingingStation} from '../../models/ringing-station.model';
import {Scientist} from '../../models/scientist.model';
import {ApiService} from '../../service/api.service';

export interface ProjectEditDialogData {
  project: Project;
  scientists: Scientist[];
}

export interface ProjectEditDialogResult {
  title: string;
  description: string;
  scientistIds: string[];
  showOptionalFields: boolean;
  showNetFields: boolean;
  projekttyp: Projekttyp;
  defaultStationHandle: string;
  // The optional per-Projekt Saison window (ADR 0029): both null ⇒ no season.
  saisonStartMonth: number | null;
  saisonEndMonth: number | null;
}

// The Saison-window month options for the settings selects. de-AT month names
// (Jänner, not Januar). Value is the 1–12 month number the backend expects.
export const SAISON_MONTH_OPTIONS: {value: number; label: string}[] = [
  'Jänner',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
].map((label, index) => ({value: index + 1, label}));

@Component({
  selector: 'app-project-edit-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule
],
  templateUrl: './project-edit-dialog.html',
  styleUrl: './project-edit-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectEditDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiService);
  private readonly dialogRef =
    inject<MatDialogRef<ProjectEditDialogComponent, ProjectEditDialogResult>>(MatDialogRef);
  readonly data = inject<ProjectEditDialogData>(MAT_DIALOG_DATA);

  readonly stations = signal<RingingStation[]>([]);
  readonly projekttypOptions = PROJEKTTYP_OPTIONS;
  readonly saisonMonthOptions = SAISON_MONTH_OPTIONS;

  readonly form = this.fb.nonNullable.group({
    title: [this.data.project.title, Validators.required],
    description: [this.data.project.description ?? ''],
    scientistIds: [
      this.data.project.scientists.map((s) => s.id),
      [Validators.required, Validators.minLength(1)],
    ],
    showOptionalFields: [this.data.project.show_optional_fields],
    // Netzfelder anzeigen (issue #336): pre-filled from the Projekt, independent
    // of show_optional_fields and of the Projekttyp. Default on for legacy rows.
    showNetFields: [this.data.project.show_net_fields ?? true],
    projekttyp: [this.data.project.projekttyp ?? Projekttyp.Sonstiges],
    defaultStationHandle: [this.data.project.default_station?.handle ?? ''],
    // The optional per-Projekt Saison window (ADR 0029): two nullable month
    // selects (1–12). Both null ⇒ no season configured (the „Diese Saison"
    // dashboard preset stays hidden). Nullable controls, so a „Keine" selection
    // clears the field.
    saisonStartMonth: this.fb.control<number | null>(
      this.data.project.saison_start_month ?? null,
    ),
    saisonEndMonth: this.fb.control<number | null>(this.data.project.saison_end_month ?? null),
  });

  constructor() {
    // The Organisation is fixed in edit mode, so the picker is scoped to it.
    this.api
      .getRingingStations(undefined, this.data.project.organization.handle)
      .subscribe({next: (res) => this.stations.set(res.results)});
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
