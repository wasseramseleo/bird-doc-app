import {ChangeDetectionStrategy, Component, inject, signal} from '@angular/core';
import {FormBuilder, ReactiveFormsModule, Validators} from '@angular/forms';
import {MatButtonModule} from '@angular/material/button';
import {MatDialogModule, MatDialogRef} from '@angular/material/dialog';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatInputModule} from '@angular/material/input';
import {MatSnackBar} from '@angular/material/snack-bar';

import {ApiService} from '../../service/api.service';

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
export class FeedbackDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiService);
  private readonly dialogRef =
    inject<MatDialogRef<FeedbackDialogComponent, boolean>>(MatDialogRef);
  private readonly snackBar = inject(MatSnackBar);

  // Disables the submit button and guards against a double-send while the
  // request is in flight.
  readonly submitting = signal(false);

  readonly form = this.fb.nonNullable.group({
    message: ['', [Validators.required, Validators.maxLength(5000)]],
  });

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
