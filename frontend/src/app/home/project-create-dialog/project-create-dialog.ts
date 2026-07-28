import {ChangeDetectionStrategy, Component, inject, signal} from '@angular/core';

import {FormBuilder, ReactiveFormsModule, Validators} from '@angular/forms';
import {MatButtonModule} from '@angular/material/button';
import {MatCheckboxModule} from '@angular/material/checkbox';
import {MatDialogModule, MatDialogRef, MAT_DIALOG_DATA} from '@angular/material/dialog';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatInputModule} from '@angular/material/input';
import {MatSelectModule} from '@angular/material/select';
import {Organization} from '../../models/organization.model';
import {
  OPTIONAL_FIELD_OPTIONS,
  OptionalField,
  PROJEKTTYP_OPTIONS,
  Projekttyp,
  hiddenOptionalFieldsFrom,
} from '../../models/project.model';
import {RingingStation} from '../../models/ringing-station.model';
import {Scientist} from '../../models/scientist.model';
import {ApiService} from '../../service/api.service';
import {
  SAISON_MONTH_OPTIONS,
  buildOptionalFieldGroup,
} from '../project-edit-dialog/project-edit-dialog';

export interface ProjectCreateDialogData {
  // The active Organisation the new Projekt will belong to. Shown as plain text,
  // never as a picker: the server attaches the Projekt to the active Organisation
  // authoritatively (issue #389), so there is nothing here for the Admin to choose.
  organization: Organization;
  scientists: Scientist[];
  // The creating Admin's own Beringer-Kürzel, or null when their account has no
  // Beringer at all — the invitation path creates a Mitgliedschaft only, so
  // /auth/me/ carries handle: null and there is nobody to preselect (issue #389).
  currentBeringerHandle: string | null;
}

export interface ProjectCreateDialogResult {
  title: string;
  description: string;
  scientistIds: string[];
  // Optionale Felder (ADR 0035): what the Admin switched OFF — the same shape and
  // the same „angehakt = sichtbar" control the Bearbeiten-Dialog carries.
  hiddenOptionalFields: OptionalField[];
  projekttyp: Projekttyp;
  defaultStationHandle: string;
  // The optional per-Projekt Saison window (ADR 0029): both null ⇒ no season.
  saisonStartMonth: number | null;
  saisonEndMonth: number | null;
}

@Component({
  selector: 'app-project-create-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule
],
  templateUrl: './project-create-dialog.html',
  styleUrl: './project-create-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectCreateDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiService);
  private readonly dialogRef = inject<MatDialogRef<ProjectCreateDialogComponent, ProjectCreateDialogResult>>(MatDialogRef);
  readonly data = inject<ProjectCreateDialogData>(MAT_DIALOG_DATA);

  readonly stations = signal<RingingStation[]>([]);
  readonly projekttypOptions = PROJEKTTYP_OPTIONS;
  readonly saisonMonthOptions = SAISON_MONTH_OPTIONS;
  readonly optionalFieldOptions = OPTIONAL_FIELD_OPTIONS;

  readonly form = this.fb.nonNullable.group({
    title: ['', Validators.required],
    description: [''],
    // The creating Admin is preselected as first Beringer but stays editable, and
    // the field is required either way: an Admin without a Beringer of their own
    // starts empty and has to pick someone, rather than silently creating a
    // Projekt with zero Beringer (issue #389).
    scientistIds: [this.creatorScientistIds(), Validators.required],
    // Optionale Felder (ADR 0035): the same „angehakt = sichtbar" control the
    // Bearbeiten-Dialog shows (Anlage/Bearbeiten-Parität, PRD #384), every box
    // ticked. NO Projekttyp seeding — ADR 0023 permits it, ADR 0035 leaves the
    // permission unused, so two Projekte created the same way never differ silently.
    optionalFields: buildOptionalFieldGroup(this.fb, []),
    projekttyp: [Projekttyp.Sonstiges],
    defaultStationHandle: [''],
    // The optional per-Projekt Saison window (ADR 0029): nullable controls, so a
    // „Keine" selection leaves the new Projekt without a season.
    saisonStartMonth: this.fb.control<number | null>(null),
    saisonEndMonth: this.fb.control<number | null>(null),
  });

  constructor() {
    // The Organisation is fixed to the active one, so the Station picker is scoped
    // to it once — there is no Organisation left to switch between.
    this.loadStations(this.data.organization.handle);
  }

  /**
   * The creating Admin's own Beringer, resolved by Kürzel against the loaded
   * Beringer: ``AuthUser`` exposes only the handle, never the ``Scientist`` id the
   * write payload needs. Empty when they have no Beringer — which leaves the
   * required field empty for them to fill in themselves.
   */
  private creatorScientistIds(): string[] {
    const handle = this.data.currentBeringerHandle;
    if (!handle) {
      return [];
    }
    const creator = this.data.scientists.find((s) => s.handle === handle);
    return creator ? [creator.id] : [];
  }

  private loadStations(organizationHandle: string): void {
    if (!organizationHandle) {
      this.stations.set([]);
      return;
    }
    this.api.getRingingStations(undefined, organizationHandle).subscribe({
      next: (res) => this.stations.set(res.results),
    });
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
