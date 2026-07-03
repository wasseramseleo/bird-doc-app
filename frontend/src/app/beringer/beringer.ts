import {ChangeDetectionStrategy, Component, OnInit, computed, inject, signal} from '@angular/core';
import {HttpErrorResponse} from '@angular/common/http';
import {MatButtonModule} from '@angular/material/button';
import {MatIconModule} from '@angular/material/icon';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {MatDialog, MatDialogModule} from '@angular/material/dialog';
import {MatSnackBar, MatSnackBarModule} from '@angular/material/snack-bar';

import {ApiService} from '../service/api.service';
import {Beringer} from '../models/beringer.model';
import {ScientistCreatePayload} from '../models/scientist.model';
import {
  BeringerFormDialogComponent,
  BeringerFormDialogData,
} from './beringer-form-dialog/beringer-form-dialog';
import {
  SeatPickerDialogComponent,
  SeatPickerDialogData,
} from './seat-picker-dialog/seat-picker-dialog';
import {
  ConfirmDialogComponent,
  ConfirmDialogData,
} from '../shared/confirm-dialog/confirm-dialog';

@Component({
  selector: 'app-beringer',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatDialogModule,
    MatSnackBarModule,
  ],
  templateUrl: './beringer.html',
  styleUrl: './beringer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BeringerComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly loading = signal<boolean>(true);
  private readonly beringer = signal<Beringer[]>([]);

  // Surname, then first name (falling back to the Kürzel for a stable order when
  // a name is blank), so the management list reads predictably regardless of the
  // order the server returns.
  readonly sortedBeringer = computed(() =>
    [...this.beringer()].sort(
      (a, b) =>
        a.last_name.localeCompare(b.last_name) ||
        a.first_name.localeCompare(b.first_name) ||
        a.handle.localeCompare(b.handle),
    ),
  );

  // Account-linked Beringer wear a "Mitglied" badge; the rest are "Ohne Konto".
  isMitglied(beringer: Beringer): boolean {
    return beringer.is_member === true;
  }

  ngOnInit(): void {
    this.load();
  }

  // Add reuses the open, idempotent-by-Kürzel create endpoint (the same one the
  // mid-session quick-add uses); the Kürzel is derived from the name in the dialog
  // but stays editable.
  openCreateDialog(): void {
    const ref = this.dialog.open<
      BeringerFormDialogComponent,
      BeringerFormDialogData,
      ScientistCreatePayload
    >(BeringerFormDialogComponent, {data: {}, width: '480px'});
    ref.afterClosed().subscribe((result) => {
      if (!result) {
        return;
      }
      this.api.createScientist(result).subscribe({
        next: (created) => {
          this.snackBar.open(`Beringer "${created.full_name}" wurde angelegt.`, 'Schließen', {
            duration: 3000,
          });
          this.load();
        },
        error: (err: HttpErrorResponse) =>
          this.snackBar.open(this.saveErrorMessage(err, 'angelegt'), 'Schließen', {duration: 5000}),
      });
    });
  }

  // Edit is the Admin-only PATCH of name + Kürzel.
  openEditDialog(beringer: Beringer): void {
    const ref = this.dialog.open<
      BeringerFormDialogComponent,
      BeringerFormDialogData,
      ScientistCreatePayload
    >(BeringerFormDialogComponent, {data: {beringer}, width: '480px'});
    ref.afterClosed().subscribe((result) => {
      if (!result) {
        return;
      }
      this.api.updateScientist(beringer.id, result).subscribe({
        next: (updated) => {
          this.snackBar.open(`Beringer "${updated.full_name}" wurde aktualisiert.`, 'Schließen', {
            duration: 3000,
          });
          this.load();
        },
        error: (err: HttpErrorResponse) =>
          this.snackBar.open(this.saveErrorMessage(err, 'aktualisiert'), 'Schließen', {
            duration: 5000,
          }),
      });
    });
  }

  // Link a no-account Beringer to a seat, promoting it to a Mitglied. The picker
  // offers only *eligible* seats — same-org accounts that are not yet a Beringer,
  // derived from /mitgliedschaften/ as those whose handle is null (PRD #205).
  openLinkDialog(beringer: Beringer): void {
    this.api.getMitgliedschaften().subscribe({
      next: (res) => {
        const eligible = res.results.filter((seat) => seat.handle === null);
        const ref = this.dialog.open<SeatPickerDialogComponent, SeatPickerDialogData, string>(
          SeatPickerDialogComponent,
          {data: {beringerName: beringer.full_name, seats: eligible}, width: '480px'},
        );
        ref.afterClosed().subscribe((mitgliedschaftId) => {
          if (!mitgliedschaftId) {
            return;
          }
          this.api.linkScientistToSeat(beringer.id, mitgliedschaftId).subscribe({
            next: (updated) => {
              this.snackBar.open(
                `Beringer "${updated.full_name}" wurde mit einem Konto verknüpft.`,
                'Schließen',
                {duration: 3000},
              );
              this.load();
            },
            error: (err: HttpErrorResponse) =>
              this.snackBar.open(this.linkErrorMessage(err, 'verknüpft'), 'Schließen', {
                duration: 5000,
              }),
          });
        });
      },
      error: () =>
        this.snackBar.open('Konten konnten nicht geladen werden.', 'Schließen', {duration: 3000}),
    });
  }

  // Unlink (detach) a Mitglied, demoting it back to a no-account Beringer. A
  // demote warning precedes the action: the account keeps its login + Rolle but
  // loses its Beringer identity and Projekt visibility until re-linked. The
  // backend refuses (400) if the Beringer already owns captures (freeze).
  openUnlinkDialog(beringer: Beringer): void {
    const ref = this.dialog.open<ConfirmDialogComponent, ConfirmDialogData, boolean>(
      ConfirmDialogComponent,
      {
        data: {
          title: 'Konto-Verknüpfung aufheben?',
          message:
            `„${beringer.full_name}“ behält Login und Rolle, verliert aber die ` +
            'Beringer-Identität und die Projekt-Sichtbarkeit, bis erneut ein Konto verknüpft wird.',
          confirmLabel: 'Verknüpfung aufheben',
        },
        width: '480px',
      },
    );
    ref.afterClosed().subscribe((confirmed) => {
      if (!confirmed) {
        return;
      }
      this.api.unlinkScientist(beringer.id).subscribe({
        next: (updated) => {
          this.snackBar.open(
            `Konto-Verknüpfung von "${updated.full_name}" wurde aufgehoben.`,
            'Schließen',
            {duration: 3000},
          );
          this.load();
        },
        error: (err: HttpErrorResponse) =>
          this.snackBar.open(this.linkErrorMessage(err, 'aufgehoben'), 'Schließen', {
            duration: 5000,
          }),
      });
    });
  }

  // Surface the server's German validation message — most importantly the
  // duplicate-Kürzel 400 on the globally-unique handle — rather than a generic
  // failure, so the Admin can disambiguate two people (issue #207).
  private saveErrorMessage(err: HttpErrorResponse, verb: string): string {
    const body = err.error as {handle?: string[]; detail?: string} | undefined;
    const serverMessage = body?.handle?.[0] ?? body?.detail;
    return serverMessage ?? `Beringer konnte nicht ${verb} werden.`;
  }

  // The link/unlink 400s land on the write-only `mitgliedschaft_id` field (the
  // freeze-once-captures, cross-tenant and seat-taken refusals), so surface that
  // German message when present; fall back to `detail` or a generic phrase.
  private linkErrorMessage(err: HttpErrorResponse, verb: string): string {
    const body = err.error as {mitgliedschaft_id?: string[]; detail?: string} | undefined;
    const serverMessage = body?.mitgliedschaft_id?.[0] ?? body?.detail;
    return serverMessage ?? `Konto konnte nicht ${verb} werden.`;
  }

  private load(): void {
    this.loading.set(true);
    this.api.getBeringer().subscribe({
      next: (res) => {
        this.beringer.set(res.results);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.snackBar.open('Beringer konnten nicht geladen werden.', 'Schließen', {duration: 3000});
      },
    });
  }
}
