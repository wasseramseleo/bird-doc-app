import {ChangeDetectionStrategy, Component, inject, signal} from '@angular/core';
import {CommonModule} from '@angular/common';
import {MatButtonModule} from '@angular/material/button';
import {MatIconModule} from '@angular/material/icon';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {MatDialogModule, MatDialogRef, MAT_DIALOG_DATA} from '@angular/material/dialog';

import {FailureBannerComponent} from '../../shared/failure-banner/failure-banner';
import {SchreibFehler} from '../../core/errors/schreib-fehler';
import {appFailureOf} from '../../core/errors/app-failure';
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
    FailureBannerComponent,
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
  // #448 (ADR 0037): der Import ist eine ausgelöste Schreibung — Vorschau wie
  // Bestätigung. Sie bekommt dasselbe Banner wie eine abgelehnte Speicherung,
  // statt einer eigenen Fehlerzeile mit eigenem Extraktor.
  readonly schreibFehler = new SchreibFehler();
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
    this.dryRun(file);
  }

  private dryRun(file: File): void {
    this.schreibFehler.leeren();
    this.loading.set(true);
    this.api.importIwmDryRun(this.data.projectId, file).subscribe({
      next: (preview) => {
        this.preview.set(preview);
        this.phase.set('preview');
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.schreibFehler.zeige(appFailureOf(err), () => this.dryRun(file));
        this.loading.set(false);
      },
    });
  }

  confirmImport(): void {
    if (!this.selectedFile) {
      return;
    }
    const file = this.selectedFile;
    this.schreibFehler.leeren();
    this.loading.set(true);
    this.api.importIwmCommit(this.data.projectId, file).subscribe({
      next: (result) => {
        this.result.set(result);
        this.phase.set('result');
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.schreibFehler.zeige(appFailureOf(err), () => this.confirmImport());
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

  // #448: `extractMessage` — der vierte handgeschriebene Extraktor — ist weg. Er
  // grub `file` bzw. `detail` eigenhändig aus dem Körper; `appFailureOf(err).text`
  // tut dasselbe für jedes Feld und liest zusätzlich den `errors`-Umschlag
  // (ADR 0038).
}
