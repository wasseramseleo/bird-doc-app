import {inject, Injectable} from '@angular/core';
import {MatDialog} from '@angular/material/dialog';
import {map, Observable, of} from 'rxjs';

import {
  ConfirmDialogComponent,
  ConfirmDialogData,
} from '../shared/confirm-dialog/confirm-dialog';

/**
 * Whether anyone is mid-capture, and the one question to ask before throwing
 * that work away (issue #407, ADR 0032).
 *
 * The dirty state is private to the capture form, but two things outside it now
 * need the answer: the `CanDeactivate` guard (leaving the form, including the
 * bare `n` shortcut) and "Jetzt aktualisieren" in the nav bar (adopting a
 * waiting Version reloads the tab). Neither can reach into the form, so the
 * form publishes a probe here and both ask through this seam.
 *
 * There is no autosave and no drafts — the outbox queues *saved* captures only —
 * so a half-entered Wiederfang lives in the reactive form and nowhere else, and
 * the Beringer entering it is holding a bird.
 */
@Injectable({providedIn: 'root'})
export class UnsavedChangesService {
  private readonly dialog = inject(MatDialog);

  // One capture form is alive at a time (a single router outlet), so a single
  // probe is enough. Kept a plain callback rather than a signal: `dirty` is a
  // reactive-forms property, and a signal mirroring it would only be as fresh as
  // whoever remembered to push to it.
  private probe: (() => boolean) | null = null;

  /** The capture form publishes its dirty state for the lifetime of the form. */
  watch(probe: () => boolean): void {
    this.probe = probe;
  }

  /** Withdraws a probe on the form's destruction. Identity-checked, so a form
   * that has already been replaced never unregisters its successor. */
  stopWatching(probe: () => boolean): void {
    if (this.probe === probe) {
      this.probe = null;
    }
  }

  hasUnsavedChanges(): boolean {
    return this.probe?.() ?? false;
  }

  /**
   * Resolves true if the caller may discard whatever is in the capture form.
   * The established `onReset` idiom (`data-entry-form.ts`, issue #24): an
   * untouched form goes through immediately with no question asked; a dirty one
   * gets a ConfirmDialogComponent. Dismissing the dialog (Escape) reads as
   * "stay" — never as permission to throw the input away.
   */
  confirmDiscard(): Observable<boolean> {
    if (!this.hasUnsavedChanges()) {
      return of(true);
    }
    const ref = this.dialog.open<ConfirmDialogComponent, ConfirmDialogData, boolean>(
      ConfirmDialogComponent,
      {
        data: {
          title: 'Erfassung verlassen?',
          message:
            'Es gibt ungespeicherte Eingaben. Möchtest du sie wirklich verwerfen?',
          confirmLabel: 'Verwerfen',
          cancelLabel: 'Weiter bearbeiten',
        },
        width: '420px',
      },
    );
    return ref.afterClosed().pipe(map((confirmed) => confirmed === true));
  }
}
