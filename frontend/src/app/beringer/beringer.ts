import {ChangeDetectionStrategy, Component, OnInit, computed, inject, signal} from '@angular/core';
import {switchMap} from 'rxjs/operators';
import {MatButtonModule} from '@angular/material/button';
import {MatIconModule} from '@angular/material/icon';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {MatDialog, MatDialogModule} from '@angular/material/dialog';
import {MatSnackBar, MatSnackBarModule} from '@angular/material/snack-bar';

import {AppIconEmptyDirective} from '../shared/app-icons';
import {FailureBannerComponent} from '../shared/failure-banner/failure-banner';
import {LoadFailureComponent} from '../shared/load-failure/load-failure';
import {AppFailure, appFailureOf} from '../core/errors/app-failure';
import {SchreibFehler} from '../core/errors/schreib-fehler';
import {ApiService} from '../service/api.service';
import {Beringer} from '../models/beringer.model';
import {Mitgliedschaft} from '../models/mitgliedschaft.model';
import {ScientistCreatePayload} from '../models/scientist.model';
import {
  BeringerFormDialogComponent,
  BeringerFormDialogData,
} from './beringer-form-dialog/beringer-form-dialog';
import {
  BeringerAssignDialogComponent,
  BeringerAssignDialogData,
  BeringerAssignResult,
} from './beringer-assign-dialog/beringer-assign-dialog';
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
    AppIconEmptyDirective,
    FailureBannerComponent,
    LoadFailureComponent,
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
  // #446 (ADR 0037): ein gescheitertes Laden ersetzt die Liste an Ort und
  // Stelle, statt drei Sekunden zu toasten und eine leere Liste stehen zu
  // lassen — die sah aus wie eine Organisation ganz ohne Beringer.
  readonly loadFailure = signal<AppFailure | null>(null);
  // #448 (ADR 0037): eine zurückgewiesene Schreibung landet im Banner, dort wo
  // die Geste stattfand — Zuordnung und Seat-Verwaltung eingeschlossen. Eine
  // Snackbar bestätigt hier nur noch, dass etwas *gelungen* ist.
  readonly schreibFehler = new SchreibFehler();
  private readonly beringer = signal<Beringer[]>([]);

  // "Mitglieder ohne Beringer-Eintrag": the Organisation's seats that have no
  // Beringer yet. Gap detection is free — a Mitgliedschaft whose `handle` is null
  // IS a member-without-a-Beringer (PRD #205, issue #210).
  readonly gapLoading = signal<boolean>(true);
  // Der stillste Ladefehler des Bildschirms (#446): das Gap-Panel rendert nur
  // bei vorhandenen Lücken, ein gescheitertes Laden sah also aus wie „keine
  // Lücken" — eine Aussage, die der Bildschirm gar nicht treffen konnte.
  readonly gapLoadFailure = signal<AppFailure | null>(null);
  private readonly gapSeats = signal<Mitgliedschaft[]>([]);

  // Stable order for the gap panel: by the seat's username so the reconciliation
  // list reads predictably regardless of the order the server pages return.
  readonly sortedGapSeats = computed(() =>
    [...this.gapSeats()].sort((a, b) => a.username.localeCompare(b.username)),
  );

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
    this.loadGaps();
  }

  // A gap member gets ONE "Beringer zuordnen" action offering two paths:
  //   verknüpfen — attach an existing no-account Beringer to the seat (the #209
  //     attach: PATCH /scientists/<id>/ {mitgliedschaft_id}), or
  //   neu anlegen — create a fresh Beringer AND link it. Because create stays
  //     link-free, this is a client-side create → attach chain: the open POST
  //     first, then the Admin PATCH {mitgliedschaft_id}.
  // On success the seat drops out of the gap panel and shows as "Mitglied" in the
  // Beringer list (both are reloaded), so the Admin sees the reconciliation land.
  openAssignDialog(seat: Mitgliedschaft): void {
    const candidates = this.beringer().filter((b) => !this.isMitglied(b));
    const ref = this.dialog.open<
      BeringerAssignDialogComponent,
      BeringerAssignDialogData,
      BeringerAssignResult
    >(BeringerAssignDialogComponent, {data: {seat, candidates}, width: '480px'});
    ref.afterClosed().subscribe((result) => {
      if (!result) {
        return;
      }
      if (result.mode === 'link') {
        this.assignExistingBeringer(seat, result.beringerId);
      } else {
        this.assignNewBeringer(seat, result.payload);
      }
    });
  }

  // verknüpfen: a single attach PATCH on the chosen existing Beringer.
  private assignExistingBeringer(seat: Mitgliedschaft, beringerId: string): void {
    this.schreibFehler.leeren();
    this.api.linkScientistToSeat(beringerId, seat.id).subscribe({
      next: (updated) => this.onAssigned(updated),
      error: (err: unknown) =>
        this.schreibFehler.zeige(appFailureOf(err), () =>
          this.assignExistingBeringer(seat, beringerId),
        ),
    });
  }

  // neu anlegen: create → attach, two calls in order (open POST, then the Admin
  // PATCH {mitgliedschaft_id} that links the fresh Beringer to the seat).
  private assignNewBeringer(seat: Mitgliedschaft, payload: ScientistCreatePayload): void {
    this.schreibFehler.leeren();
    this.api
      .createScientist(payload)
      .pipe(switchMap((created) => this.api.linkScientistToSeat(created.id, seat.id)))
      .subscribe({
        next: (updated) => this.onAssigned(updated),
        error: (err: unknown) =>
          this.schreibFehler.zeige(appFailureOf(err), () => this.assignNewBeringer(seat, payload)),
      });
  }

  // Give the Admin feedback the reconciliation worked, then refresh BOTH lists:
  // the Beringer list (the member now shows as "Mitglied") and the gap panel (the
  // seat now has a handle, so it drops out).
  private onAssigned(updated: Beringer): void {
    this.snackBar.open(
      `„${updated.full_name}“ wurde als Mitglied zugeordnet.`,
      'Schließen',
      {duration: 3000},
    );
    this.load();
    this.loadGaps();
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
      this.createBeringer(result);
    });
  }

  private createBeringer(payload: ScientistCreatePayload): void {
    this.schreibFehler.leeren();
    this.api.createScientist(payload).subscribe({
      next: (created) => {
        this.snackBar.open(`Beringer "${created.full_name}" wurde angelegt.`, 'Schließen', {
          duration: 3000,
        });
        this.load();
      },
      error: (err: unknown) =>
        this.schreibFehler.zeige(appFailureOf(err), () => this.createBeringer(payload)),
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
      this.updateBeringer(beringer, result);
    });
  }

  private updateBeringer(beringer: Beringer, payload: ScientistCreatePayload): void {
    this.schreibFehler.leeren();
    this.api.updateScientist(beringer.id, payload).subscribe({
      next: (updated) => {
        this.snackBar.open(`Beringer "${updated.full_name}" wurde aktualisiert.`, 'Schließen', {
          duration: 3000,
        });
        this.load();
      },
      error: (err: unknown) =>
        this.schreibFehler.zeige(appFailureOf(err), () => this.updateBeringer(beringer, payload)),
    });
  }

  // Link a no-account Beringer to a seat, promoting it to a Mitglied. The picker
  // offers only *eligible* seats — same-org accounts that are not yet a Beringer,
  // derived from /mitgliedschaften/ as those whose handle is null (PRD #205).
  openLinkDialog(beringer: Beringer): void {
    this.schreibFehler.leeren();
    this.api.getAllMitgliedschaften().subscribe({
      next: (seats) => {
        const eligible = seats.filter((seat) => seat.handle === null);
        const ref = this.dialog.open<SeatPickerDialogComponent, SeatPickerDialogData, string>(
          SeatPickerDialogComponent,
          {data: {beringerName: beringer.full_name, seats: eligible}, width: '480px'},
        );
        ref.afterClosed().subscribe((mitgliedschaftId) => {
          if (!mitgliedschaftId) {
            return;
          }
          this.linkToSeat(beringer, mitgliedschaftId);
        });
      },
      // Ein Lesevorgang, der an einer Geste hängt: ohne die Konten öffnet der
      // Picker gar nicht, es gibt also keinen Inhalt, den ein In-Place-Zustand
      // ersetzen könnte (#446). Gemeldet wird deshalb dort, wo gedrückt wurde —
      // wie die Ringhistorie im Erfassungsformular seit #443.
      error: (err: unknown) =>
        this.schreibFehler.zeige(appFailureOf(err), () => this.openLinkDialog(beringer)),
    });
  }

  private linkToSeat(beringer: Beringer, mitgliedschaftId: string): void {
    this.schreibFehler.leeren();
    this.api.linkScientistToSeat(beringer.id, mitgliedschaftId).subscribe({
      next: (updated) => {
        this.snackBar.open(
          `Beringer "${updated.full_name}" wurde mit einem Konto verknüpft.`,
          'Schließen',
          {duration: 3000},
        );
        this.load();
      },
      error: (err: unknown) =>
        this.schreibFehler.zeige(appFailureOf(err), () =>
          this.linkToSeat(beringer, mitgliedschaftId),
        ),
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
      this.unlink(beringer);
    });
  }

  private unlink(beringer: Beringer): void {
    this.schreibFehler.leeren();
    this.api.unlinkScientist(beringer.id).subscribe({
      next: (updated) => {
        this.snackBar.open(
          `Konto-Verknüpfung von "${updated.full_name}" wurde aufgehoben.`,
          'Schließen',
          {duration: 3000},
        );
        this.load();
      },
      error: (err: unknown) =>
        this.schreibFehler.zeige(appFailureOf(err), () => this.unlink(beringer)),
    });
  }

  // Delete a Beringer (PRD #205, issue #208). A Mitglied cannot be deleted here —
  // the action is disabled in the template with a hint to remove the account in
  // member management first; this guard is belt-and-braces. For a capture-owning
  // Beringer the confirmation NAMES how many Fänge will be reassigned to
  // „Gelöschter Nutzer"; a no-capture Beringer gets a plain confirm. On success
  // the list reloads.
  openDeleteDialog(beringer: Beringer): void {
    if (this.isMitglied(beringer)) {
      return;
    }
    const count = beringer.capture_count ?? 0;
    const message =
      count > 0
        ? `„${beringer.full_name}“ wird gelöscht und ${this.faengeSummary(count)} ` +
          'werden „Gelöschter Nutzer“ zugeordnet. Diese Aktion kann nicht rückgängig gemacht werden.'
        : `„${beringer.full_name}“ wird endgültig gelöscht. ` +
          'Diese Aktion kann nicht rückgängig gemacht werden.';
    const ref = this.dialog.open<ConfirmDialogComponent, ConfirmDialogData, boolean>(
      ConfirmDialogComponent,
      {
        data: {title: 'Beringer löschen?', message, confirmLabel: 'Löschen'},
        width: '480px',
      },
    );
    ref.afterClosed().subscribe((confirmed) => {
      if (!confirmed) {
        return;
      }
      this.deleteBeringer(beringer);
    });
  }

  private deleteBeringer(beringer: Beringer): void {
    this.schreibFehler.leeren();
    this.api.deleteScientist(beringer.id).subscribe({
      next: () => {
        this.snackBar.open(`Beringer „${beringer.full_name}“ wurde gelöscht.`, 'Schließen', {
          duration: 3000,
        });
        this.load();
      },
      error: (err: unknown) =>
        this.schreibFehler.zeige(appFailureOf(err), () => this.deleteBeringer(beringer)),
    });
  }

  // Singular/plural Fänge count for the delete confirmation.
  private faengeSummary(count: number): string {
    return count === 1 ? '1 Fang' : `${count} Fänge`;
  }

  // #448: die drei handgeschriebenen Extraktoren dieses Bildschirms
  // (`deleteErrorMessage`, `saveErrorMessage`, `linkErrorMessage`) sind weg. Sie
  // gruben je eigenhändig `detail`, `handle[0]` oder `mitgliedschaft_id[0]` aus
  // dem Körper — dieselbe Arbeit dreimal, jede mit ihrem eigenen Ersatzsatz und
  // jede blind für jeden anderen Feldfehler. Der Serversatz kommt jetzt aus
  // `appFailureOf(err).text`, der den `errors`-Umschlag liest (ADR 0038).

  // protected, weil „Erneut laden" aus dem In-Place-Fehlerzustand genau hierher
  // zurückkommt (#446).
  protected load(): void {
    this.loading.set(true);
    this.loadFailure.set(null);
    this.api.getBeringer().subscribe({
      next: (res) => {
        this.beringer.set(res.results);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.loadFailure.set(appFailureOf(err));
      },
    });
  }

  // Reads the COMPLETE, paged-through seat list and keeps only the gaps
  // (handle === null). Paging matters: an AC requires the panel to list exactly
  // ALL handle==null seats, so a first-page-only read could miss gaps.
  protected loadGaps(): void {
    this.gapLoading.set(true);
    this.gapLoadFailure.set(null);
    this.api.getAllMitgliedschaften().subscribe({
      next: (seats) => {
        this.gapSeats.set(seats.filter((seat) => seat.handle === null));
        this.gapLoading.set(false);
      },
      error: (err: unknown) => {
        this.gapLoading.set(false);
        this.gapLoadFailure.set(appFailureOf(err));
      },
    });
  }
}
