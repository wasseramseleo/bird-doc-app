import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {FormBuilder, ReactiveFormsModule, Validators} from '@angular/forms';
import {MatButtonModule} from '@angular/material/button';
import {MAT_DIALOG_DATA, MatDialogModule, MatDialogRef} from '@angular/material/dialog';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatInputModule} from '@angular/material/input';
import {MatSnackBar} from '@angular/material/snack-bar';

import {ApiService} from '../../service/api.service';

/**
 * What „Fehler melden" hands the dialog (issue #449, ADR 0037): the technical
 * block, as plain text.
 *
 * The message field is free text, so a pre-filled report needs **no second
 * dialog** and no backend change — `feedback_view` goes on taking a message and
 * mailing it. Opened from the nav bar there is no data at all, and the field
 * starts empty exactly as before.
 */
export interface FeedbackDialogData {
  /** The pre-filled message — the Mitglied's own words go above it. */
  readonly prefill?: string;
}

@Component({
  selector: 'app-feedback-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  templateUrl: './feedback-dialog.html',
  styleUrl: './feedback-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeedbackDialogComponent implements AfterViewInit {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiService);
  private readonly dialogRef =
    inject<MatDialogRef<FeedbackDialogComponent, boolean>>(MatDialogRef);
  private readonly snackBar = inject(MatSnackBar);
  // Optional: the nav bar opens this dialog with no data at all (issue #81),
  // „Fehler melden" opens the same one with a pre-filled report (issue #449).
  private readonly data = inject<FeedbackDialogData | null>(MAT_DIALOG_DATA, {optional: true});

  private readonly messageField =
    viewChild.required<ElementRef<HTMLTextAreaElement>>('messageField');

  // Disables the submit button and guards against a double-send while the
  // request is in flight.
  readonly submitting = signal(false);

  readonly form = this.fb.nonNullable.group({
    message: [this.data?.prefill ?? '', [Validators.required, Validators.maxLength(5000)]],
  });

  /**
   * The cursor sits **above** the pre-filled block (issue #449): the Mitglied
   * writes first and the technical block travels along underneath. Focusing
   * a textarea puts the caret at the end, so it is moved back explicitly.
   *
   * Focusing here also settles who wins: the dialog's own focus trap runs in an
   * `afterNextRender` and only focuses the dialog container when focus is not
   * already inside it — which it is by then.
   */
  ngAfterViewInit(): void {
    if (!this.data?.prefill) {
      return;
    }
    const field = this.messageField().nativeElement;
    field.focus();
    field.setSelectionRange(0, 0);
  }

  submit(): void {
    const message = this.form.getRawValue().message.trim();
    // Validators.required accepts whitespace-only input, so re-check the trimmed
    // message — an empty one is rejected by the backend anyway.
    if (this.form.invalid || !message || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.api.sendFeedback(message).subscribe({
      next: () => {
        this.snackBar.open('Danke für dein Feedback!', 'OK', {duration: 4000});
        this.dialogRef.close(true);
      },
      error: () => {
        this.submitting.set(false);
        this.snackBar.open(
          'Senden fehlgeschlagen. Bitte versuche es später erneut.',
          'OK',
          {duration: 6000},
        );
      },
    });
  }

  cancel(): void {
    this.dialogRef.close(false);
  }
}
