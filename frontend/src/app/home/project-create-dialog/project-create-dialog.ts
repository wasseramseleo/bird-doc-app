import {ChangeDetectionStrategy, Component, inject, signal} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';

import {FormBuilder, ReactiveFormsModule, Validators} from '@angular/forms';
import {MatButtonModule} from '@angular/material/button';
import {MatDialogModule, MatDialogRef, MAT_DIALOG_DATA} from '@angular/material/dialog';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatInputModule} from '@angular/material/input';
import {MatSelectModule} from '@angular/material/select';
import {Organization} from '../../models/organization.model';
import {RingingStation} from '../../models/ringing-station.model';
import {ApiService} from '../../service/api.service';

export interface ProjectCreateDialogData {
  organizations: Organization[];
}

export interface ProjectCreateDialogResult {
  title: string;
  description: string;
  organizationHandle: string;
  defaultStationHandle: string;
}

@Component({
  selector: 'app-project-create-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
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

  readonly form = this.fb.nonNullable.group({
    title: ['', Validators.required],
    description: [''],
    organizationHandle: [this.data.organizations[0]?.handle ?? '', Validators.required],
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
