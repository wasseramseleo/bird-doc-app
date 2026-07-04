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
import {ApiService} from '../../service/api.service';

export interface ProjectCreateDialogData {
  organizations: Organization[];
}

export interface ProjectCreateDialogResult {
  title: string;
  description: string;
  organizationHandle: string;
  projekttyp: Projekttyp;
  showNetFields: boolean;
  defaultStationHandle: string;
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

  readonly form = this.fb.nonNullable.group({
    title: ['', Validators.required],
    description: [''],
    organizationHandle: [this.data.organizations[0]?.handle ?? '', Validators.required],
    projekttyp: [Projekttyp.Sonstiges],
    // Netzfelder anzeigen (issue #336): default on, parallel to the edit dialog's
    // "Optionale Felder anzeigen". Nestlingsberingung may seed it off below.
    showNetFields: [true],
    defaultStationHandle: [''],
  });

  readonly showOrganizationPicker = this.data.organizations.length > 1;

  constructor() {
    const orgControl = this.form.controls.organizationHandle;
    this.loadStations(orgControl.value);
    // When the Organisation changes, the previously picked Station may belong to
    // another Organisation, so clear it and reload the picker's options.
    orgControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((handle) => {
      this.form.controls.defaultStationHandle.setValue('');
      this.loadStations(handle);
    });
    // Create-time seed (ADR 0023): choosing Nestlingsberingung — the one listed
    // programme that rings in the nest and uses no mist-nets — pre-sets Netzfelder
    // off as a convenience. It is a suggestion only: the Admin stays free to turn
    // it back on, and the two are never hard-coupled.
    this.form.controls.projekttyp.valueChanges.pipe(takeUntilDestroyed()).subscribe((typ) => {
      this.form.controls.showNetFields.setValue(typ !== Projekttyp.Nestlingsberingung);
    });
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
