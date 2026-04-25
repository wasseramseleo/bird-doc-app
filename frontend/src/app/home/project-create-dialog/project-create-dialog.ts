import {ChangeDetectionStrategy, Component, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormBuilder, ReactiveFormsModule, Validators} from '@angular/forms';
import {MatButtonModule} from '@angular/material/button';
import {MatDialogModule, MatDialogRef, MAT_DIALOG_DATA} from '@angular/material/dialog';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatInputModule} from '@angular/material/input';
import {MatSelectModule} from '@angular/material/select';
import {Organization} from '../../models/organization.model';

export interface ProjectCreateDialogData {
  organizations: Organization[];
}

export interface ProjectCreateDialogResult {
  title: string;
  description: string;
  organizationHandle: string;
}

@Component({
  selector: 'app-project-create-dialog',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  templateUrl: './project-create-dialog.html',
  styleUrl: './project-create-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectCreateDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly dialogRef = inject<MatDialogRef<ProjectCreateDialogComponent, ProjectCreateDialogResult>>(MatDialogRef);
  readonly data = inject<ProjectCreateDialogData>(MAT_DIALOG_DATA);

  readonly form = this.fb.nonNullable.group({
    title: ['', Validators.required],
    description: [''],
    organizationHandle: [this.data.organizations[0]?.handle ?? '', Validators.required],
  });

  readonly showOrganizationPicker = this.data.organizations.length > 1;

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
