import {ChangeDetectionStrategy, Component, inject, signal} from '@angular/core';

import {FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators} from '@angular/forms';
import {MatButtonModule} from '@angular/material/button';
import {MatCheckboxModule} from '@angular/material/checkbox';
import {MatDialogModule, MatDialogRef, MAT_DIALOG_DATA} from '@angular/material/dialog';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatInputModule} from '@angular/material/input';
import {MatSelectModule} from '@angular/material/select';
import {
  OPTIONAL_FIELD_OPTIONS,
  OPTIONAL_FIELD_ORDER,
  OptionalField,
  PROJEKTTYP_OPTIONS,
  Project,
  Projekttyp,
  hiddenOptionalFieldsFrom,
  optionalFieldVisibility,
} from '../../models/project.model';
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
  // Optionale Felder (ADR 0035): what the Admin switched OFF. The dialog shows
  // „angehakt = sichtbar"; the inversion to the stored opt-out list happens here,
  // on save, so the display follows the expectation and the storage follows the rule.
  hiddenOptionalFields: OptionalField[];
  projekttyp: Projekttyp;
  defaultStationHandle: string;
  // The optional per-Projekt Saison window (ADR 0029): both null ⇒ no season.
  saisonStartMonth: number | null;
  saisonEndMonth: number | null;
}

/**
 * The „angehakt = sichtbar" checkbox group both Projekt-Dialoge render (ADR 0035,
 * the Anlage/Bearbeiten parity PRD #384 established). One boolean control per
 * vocabulary entry, pre-filled from the Projekt's opt-out list.
 */
export function buildOptionalFieldGroup(
  fb: FormBuilder,
  hidden: readonly OptionalField[] | null | undefined,
): FormGroup<Record<OptionalField, FormControl<boolean>>> {
  const visible = optionalFieldVisibility(hidden);
  const controls = Object.fromEntries(
    OPTIONAL_FIELD_ORDER.map((field) => [field, fb.nonNullable.control(visible[field])]),
  ) as Record<OptionalField, FormControl<boolean>>;
  return fb.group(controls);
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
  readonly optionalFieldOptions = OPTIONAL_FIELD_OPTIONS;

  readonly form = this.fb.nonNullable.group({
    title: [this.data.project.title, Validators.required],
    description: [this.data.project.description ?? ''],
    scientistIds: [
      this.data.project.scientists.map((s) => s.id),
      [Validators.required, Validators.minLength(1)],
    ],
    // Optionale Felder (ADR 0035): angehakt = sichtbar, pre-filled from the
    // Projekt's opt-out list. A Projekt that hides nothing — including one whose
    // cached copy predates the field — shows every box ticked.
    optionalFields: buildOptionalFieldGroup(this.fb, this.data.project.hidden_optional_fields),
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
    const {optionalFields, ...rest} = this.form.getRawValue();
    this.dialogRef.close({
      ...rest,
      hiddenOptionalFields: hiddenOptionalFieldsFrom(optionalFields),
    });
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
