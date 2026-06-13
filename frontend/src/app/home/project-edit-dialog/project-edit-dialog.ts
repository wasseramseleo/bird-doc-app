import {ChangeDetectionStrategy, Component, inject, signal} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormBuilder, ReactiveFormsModule, Validators} from '@angular/forms';
import {MatButtonModule} from '@angular/material/button';
import {MatCheckboxModule} from '@angular/material/checkbox';
import {MatDialogModule, MatDialogRef, MAT_DIALOG_DATA} from '@angular/material/dialog';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatInputModule} from '@angular/material/input';
import {MatSelectModule} from '@angular/material/select';
import {Project} from '../../models/project.model';
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
  defaultStationHandle: string;
}

@Component({
  selector: 'app-project-edit-dialog',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
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

  readonly form = this.fb.nonNullable.group({
    title: [this.data.project.title, Validators.required],
    description: [this.data.project.description ?? ''],
    scientistIds: [
      this.data.project.scientists.map((s) => s.id),
      [Validators.required, Validators.minLength(1)],
    ],
    showOptionalFields: [this.data.project.show_optional_fields],
    defaultStationHandle: [this.data.project.default_station?.handle ?? ''],
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
