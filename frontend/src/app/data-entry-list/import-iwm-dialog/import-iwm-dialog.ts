import {ChangeDetectionStrategy, Component, inject, signal} from '@angular/core';
import {CommonModule} from '@angular/common';
import {MatButtonModule} from '@angular/material/button';
import {MatIconModule} from '@angular/material/icon';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {MatDialogModule, MatDialogRef, MAT_DIALOG_DATA} from '@angular/material/dialog';

import {ApiService} from '../../service/api.service';
import {ImportPreview, ImportResult} from '../../models/iwm-import.model';

export interface ImportIwmDialogData {
  projectId: string;
  projectTitle: string;
}

// Which step of the two-phase flow the dialog is showing.
type Phase = 'select' | 'preview' | 'result';

@Component({
  selector: 'app-import-iwm-dialog',
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './import-iwm-dialog.html',
  styleUrl: './import-iwm-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImportIwmDialogComponent {
  private readonly api = inject(ApiService);
  private readonly dialogRef =
    inject<MatDialogRef<ImportIwmDialogComponent, boolean>>(MatDialogRef);
  readonly data = inject<ImportIwmDialogData>(MAT_DIALOG_DATA);

  readonly phase = signal<Phase>('select');
  readonly loading = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);
  readonly fileName = signal<string | null>(null);
  readonly preview = signal<ImportPreview | null>(null);
  readonly result = signal<ImportResult | null>(null);

  // Held so the confirm phase commits the *same* upload the preview validated —
  // the two-step flow never asks the user to pick the file twice.
  private selectedFile: File | null = null;

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Reset the native input so re-picking the same file fires change again.
    input.value = '';
    if (!file) {
      return;
    }
    this.selectedFile = file;
    this.fileName.set(file.name);
    this.errorMessage.set(null);
    this.loading.set(true);
    this.api.importIwmDryRun(this.data.projectId, file).subscribe({
      next: (preview) => {
        this.preview.set(preview);
        this.phase.set('preview');
        this.loading.set(false);
      },
      error: (err) => {
        this.errorMessage.set(this.extractMessage(err));
        this.loading.set(false);
      },
    });
  }

  confirmImport(): void {
    if (!this.selectedFile) {
      return;
    }
    this.errorMessage.set(null);
    this.loading.set(true);
    this.api.importIwmCommit(this.data.projectId, this.selectedFile).subscribe({
      next: (result) => {
        this.result.set(result);
        this.phase.set('result');
        this.loading.set(false);
      },
      error: (err) => {
        this.errorMessage.set(this.extractMessage(err));
        this.loading.set(false);
      },
    });
  }

  // Cancelling after the preview backs out with nothing written (the dry-run
  // never wrote). Resolving to false tells the caller not to refresh the list.
  cancel(): void {
    this.dialogRef.close(false);
  }

  // After a commit the caller refreshes the capture list, so close with true.
  finish(): void {
    this.dialogRef.close(true);
  }

  private extractMessage(err: unknown): string {
    const error = (err as {error?: {file?: string | string[]; detail?: string}})?.error;
    const file = error?.file;
    if (Array.isArray(file)) {
      return file.join(' ');
    }
    return file ?? error?.detail ?? 'Der Import ist fehlgeschlagen.';
  }
}
