import {ChangeDetectionStrategy, Component, OnInit, computed, inject, signal} from '@angular/core';
import {HttpErrorResponse} from '@angular/common/http';

import {MatButtonModule} from '@angular/material/button';
import {MatIconModule} from '@angular/material/icon';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {MatDialog, MatDialogModule} from '@angular/material/dialog';
import {MatSnackBar, MatSnackBarModule} from '@angular/material/snack-bar';

import {AppIconEmptyDirective} from '../shared/app-icons';
import {LoadFailureComponent} from '../shared/load-failure/load-failure';
import {AppFailure, appFailureOf} from '../core/errors/app-failure';
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
      this.api.createRingingStation(result).subscribe({
        next: (station) => {
          this.snackBar.open(`Station "${station.name}" wurde angelegt.`, 'Schließen', {duration: 3000});
          this.load();
        },
        error: () => {
          this.snackBar.open('Station konnte nicht angelegt werden.', 'Schließen', {duration: 3000});
        },
      });
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
      this.api.updateRingingStation(station.handle, result).subscribe({
        next: (updated) => {
          this.snackBar.open(`Station "${updated.name}" wurde aktualisiert.`, 'Schließen', {duration: 3000});
          this.load();
        },
        error: () => {
          this.snackBar.open('Station konnte nicht aktualisiert werden.', 'Schließen', {duration: 3000});
        },
      });
    });
  }

  archive(station: RingingStation): void {
    this.setActive(station, false, `Station "${station.name}" wurde archiviert.`);
  }

  unarchive(station: RingingStation): void {
    this.setActive(station, true, `Station "${station.name}" ist wieder aktiv.`);
  }

  private setActive(station: RingingStation, isActive: boolean, message: string): void {
    this.api.setRingingStationActive(station.handle, isActive).subscribe({
      next: () => {
        this.snackBar.open(message, 'Schließen', {duration: 3000});
        this.load();
      },
      error: () => {
        this.snackBar.open('Der Status konnte nicht geändert werden.', 'Schließen', {duration: 3000});
      },
    });
  }

  remove(station: RingingStation): void {
    this.api.deleteRingingStation(station.handle).subscribe({
      next: () => {
        this.snackBar.open(`Station "${station.name}" wurde gelöscht.`, 'Schließen', {duration: 3000});
        this.load();
      },
      error: (err: HttpErrorResponse) => {
        // A Station that owns Fänge cannot be hard-deleted (backend 409); surface
        // the German refusal and offer archiving as the path forward (ADR 0011).
        if (err.status === 409) {
          const detail =
            (err.error && (err.error as {detail?: string}).detail) ??
            'Diese Station kann nicht gelöscht werden. Archiviere sie stattdessen.';
          this.snackBar
            .open(detail, 'Archivieren', {duration: 8000})
            .onAction()
            .subscribe(() => this.archive(station));
        } else {
          this.snackBar.open('Station konnte nicht gelöscht werden.', 'Schließen', {duration: 3000});
        }
      },
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
