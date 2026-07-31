import {ChangeDetectionStrategy, Component, OnInit, computed, inject, signal} from '@angular/core';

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
import {RingingStation, RingingStationCreatePayload} from '../models/ringing-station.model';
import {StationFormDialogComponent, StationFormDialogData} from './station-form-dialog/station-form-dialog';

@Component({
  selector: 'app-stationen',
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
  templateUrl: './stationen.html',
  styleUrl: './stationen.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StationenComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly loading = signal<boolean>(true);
  // #446 (ADR 0037): ein gescheitertes Laden ersetzt die Liste an Ort und
  // Stelle. Vorher setzte es nur `loading` zurück und toastete drei Sekunden —
  // danach stand dieselbe leere Liste da wie bei einer Organisation ohne
  // Station, und die beiden waren nicht zu unterscheiden.
  readonly loadFailure = signal<AppFailure | null>(null);
  // #448 (ADR 0037): eine zurückgewiesene Schreibung landet im Banner, dort wo
  // die Geste stattfand — und bleibt dort. Eine Snackbar bestätigt hier nur
  // noch, dass etwas *gelungen* ist.
  readonly schreibFehler = new SchreibFehler();
  private readonly stations = signal<RingingStation[]>([]);

  // Active Stationen first, then archived; alphabetical within each group so the
  // list reads predictably.
  readonly sortedStations = computed(() =>
    [...this.stations()].sort((a, b) => {
      const rank = (s: RingingStation) => (this.isArchived(s) ? 1 : 0);
      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    }),
  );

  isArchived(station: RingingStation): boolean {
    return station.is_active === false;
  }

  ngOnInit(): void {
    this.load();
  }

  openCreateDialog(): void {
    const ref = this.dialog.open<
      StationFormDialogComponent,
      StationFormDialogData,
      RingingStationCreatePayload
    >(StationFormDialogComponent, {data: {}, width: '480px'});
    ref.afterClosed().subscribe((result) => {
      if (!result) {
        return;
      }
      this.createStation(result);
    });
  }

  private createStation(payload: RingingStationCreatePayload): void {
    this.schreibFehler.leeren();
    this.api.createRingingStation(payload).subscribe({
      next: (station) => {
        this.snackBar.open(`Station "${station.name}" wurde angelegt.`, 'Schließen', {duration: 3000});
        this.load();
      },
      error: (err: unknown) =>
        this.schreibFehler.zeige(appFailureOf(err), () => this.createStation(payload)),
    });
  }

  openEditDialog(station: RingingStation): void {
    const ref = this.dialog.open<
      StationFormDialogComponent,
      StationFormDialogData,
      RingingStationCreatePayload
    >(StationFormDialogComponent, {data: {station}, width: '480px'});
    ref.afterClosed().subscribe((result) => {
      if (!result) {
        return;
      }
      this.updateStation(station, result);
    });
  }

  private updateStation(station: RingingStation, payload: RingingStationCreatePayload): void {
    this.schreibFehler.leeren();
    this.api.updateRingingStation(station.handle, payload).subscribe({
      next: (updated) => {
        this.snackBar.open(`Station "${updated.name}" wurde aktualisiert.`, 'Schließen', {duration: 3000});
        this.load();
      },
      error: (err: unknown) =>
        this.schreibFehler.zeige(appFailureOf(err), () => this.updateStation(station, payload)),
    });
  }

  archive(station: RingingStation): void {
    this.schreibFehler.leeren();
    this.api.setRingingStationActive(station.handle, false).subscribe({
      next: () => {
        this.snackBar.open(`Station "${station.name}" wurde archiviert.`, 'Schließen', {duration: 3000});
        this.load();
      },
      error: (err: unknown) =>
        this.schreibFehler.zeige(appFailureOf(err), () => this.archive(station)),
    });
  }

  unarchive(station: RingingStation): void {
    this.schreibFehler.leeren();
    this.api.setRingingStationActive(station.handle, true).subscribe({
      next: () => {
        this.snackBar.open(`Station "${station.name}" ist wieder aktiv.`, 'Schließen', {duration: 3000});
        this.load();
      },
      error: (err: unknown) =>
        this.schreibFehler.zeige(appFailureOf(err), () => this.unarchive(station)),
    });
  }

  remove(station: RingingStation): void {
    this.schreibFehler.leeren();
    this.api.deleteRingingStation(station.handle).subscribe({
      next: () => {
        this.snackBar.open(`Station "${station.name}" wurde gelöscht.`, 'Schließen', {duration: 3000});
        this.load();
      },
      // #448: der handgeschriebene Extraktor für den 409 („die Station trägt
      // Fänge", ADR 0011) ist weg — der Serversatz kommt jetzt aus derselben
      // Einordnung wie überall sonst, und er steht im Banner statt in einer
      // Snackbar, die nach acht Sekunden geht. Die „Archivieren"-Aktion der
      // Snackbar geht mit: sie steht als Knopf an der Station selbst, und der
      // Serversatz nennt sie beim Namen.
      error: (err: unknown) =>
        this.schreibFehler.zeige(appFailureOf(err), () => this.remove(station)),
    });
  }

  // protected, weil „Erneut laden" aus dem In-Place-Fehlerzustand genau hierher
  // zurückkommt (#446).
  protected load(): void {
    this.loading.set(true);
    this.loadFailure.set(null);
    // include_archived so the management list shows retired sites too; the
    // capture picker keeps its default active-only view.
    this.api.getRingingStations(undefined, undefined, true).subscribe({
      next: (res) => {
        this.stations.set(res.results);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.loadFailure.set(appFailureOf(err));
      },
    });
  }
}
