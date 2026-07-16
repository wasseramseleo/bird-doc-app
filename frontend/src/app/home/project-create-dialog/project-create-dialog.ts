import {ChangeDetectionStrategy, Component, inject, signal} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';

import {FormBuilder, ReactiveFormsModule, Validators} from '@angular/forms';
import {MatButtonModule} from '@angular/material/button';
import {MatCheckboxModule} from '@angular/material/checkbox';
import {MatDialogModule, MatDialogRef, MAT_DIALOG_DATA} from '@angular/material/dialog';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatInputModule} from '@angular/material/input';
import {MatSelectModule} from '@angular/material/select';
import {Organization} from '../../models/organization.model';
import {PROJEKTTYP_OPTIONS, Projekttyp} from '../../models/project.model';
import {RingingStation} from '../../models/ringing-station.model';
import {Scientist} from '../../models/scientist.model';
import {ApiService} from '../../service/api.service';
import {SAISON_MONTH_OPTIONS} from '../project-edit-dialog/project-edit-dialog';

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
  showOptionalFields: boolean;
  showNetFields: boolean;
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

  readonly form = this.fb.nonNullable.group({
    title: ['', Validators.required],
    description: [''],
    // The creating Admin is preselected as first Beringer but stays editable, and
    // the field is required either way: an Admin without a Beringer of their own
    // starts empty and has to pick someone, rather than silently creating a
    // Projekt with zero Beringer (issue #389).
    scientistIds: [this.creatorScientistIds(), Validators.required],
    showOptionalFields: [false],
    // Netzfelder anzeigen (issue #336): default on, parallel to the edit dialog's
    // "Optionale Felder anzeigen". Nestlingsberingung may seed it off below.
    showNetFields: [true],
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
    // Create-time seed (issue #337, ADR 0023): choosing Nestlingsberingung — the
    // one listed programme that rings in the nest and uses no mist-nets — pre-sets
    // Netzfelder off as a convenience. It is a one-way suggestion only: the Admin
    // stays free to turn it back on, and picking any OTHER Projekttyp must not force
    // the checkbox to any value (never re-raising it). The two are never hard-coupled.
    this.form.controls.projekttyp.valueChanges.pipe(takeUntilDestroyed()).subscribe((typ) => {
      if (typ === Projekttyp.Nestlingsberingung) {
        this.form.controls.showNetFields.setValue(false);
      }
    });
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
    this.dialogRef.close(this.form.getRawValue());
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
