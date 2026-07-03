import {ChangeDetectionStrategy, Component, OnInit, computed, inject, signal} from '@angular/core';
import {HttpErrorResponse} from '@angular/common/http';
import {forkJoin} from 'rxjs';
import {MatButtonModule} from '@angular/material/button';
import {MatIconModule} from '@angular/material/icon';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {MatDialog, MatDialogModule} from '@angular/material/dialog';
import {MatSnackBar, MatSnackBarModule} from '@angular/material/snack-bar';

import {ApiService} from '../service/api.service';
import {
  EffectiveSpeciesNorm,
  SpeciesNormOverride,
  SpeciesNormOverridePayload,
} from '../models/species-norm.model';
import {
  ArtennormFormDialogComponent,
  ArtennormFormDialogData,
} from './artennorm-form-dialog/artennorm-form-dialog';
import {ConfirmDialogComponent, ConfirmDialogData} from '../shared/confirm-dialog/confirm-dialog';

// One row of the editor list: an Art in force, marked Standard (the shared global
// default) or angepasst (this Organisation holds an override), plus the effective
// norm the per-species dialog pre-fills from and the override id to reset it.
interface NormRow {
  species_id: string;
  species_name: string;
  is_override: boolean;
  override_id: string | null;
  norm: EffectiveSpeciesNorm;
}

@Component({
  selector: 'app-artennormen',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatDialogModule,
    MatSnackBarModule,
  ],
  templateUrl: './artennormen.html',
  styleUrl: './artennormen.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArtennormenComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly loading = signal<boolean>(true);
  private readonly rows = signal<NormRow[]>([]);

  // Alphabetical by Art so the list reads predictably regardless of server order.
  readonly sortedRows = computed(() =>
    [...this.rows()].sort((a, b) => a.species_name.localeCompare(b.species_name)),
  );

  ngOnInit(): void {
    this.load();
  }

  // Add reuses the same dialog with no species pre-selected: an Artennorm can be
  // added for ANY Art, including one with no global default (PRD #245). Save is a
  // single upsert POST — the backend keys on species within the Organisation.
  openAddDialog(): void {
    this.openDialog({});
  }

  // Tune the effective norm of an Art already in force: the dialog pre-fills from
  // the effective values (default or the current override). Save creates the
  // override (Standard → angepasst) or updates it.
  openEditDialog(row: NormRow): void {
    this.openDialog({norm: row.norm});
  }

  private openDialog(data: ArtennormFormDialogData): void {
    const ref = this.dialog.open<
      ArtennormFormDialogComponent,
      ArtennormFormDialogData,
      SpeciesNormOverridePayload
    >(ArtennormFormDialogComponent, {data, width: '560px'});
    ref.afterClosed().subscribe((payload) => {
      if (!payload) {
        return;
      }
      this.api.saveSpeciesNormOverride(payload).subscribe({
        next: (saved: SpeciesNormOverride) => {
          this.snackBar.open(
            `Artennorm für „${saved.species_name}“ wurde gespeichert.`,
            'Schließen',
            {duration: 3000},
          );
          this.load();
        },
        error: (err: HttpErrorResponse) =>
          this.snackBar.open(this.errorMessage(err, 'gespeichert'), 'Schließen', {duration: 5000}),
      });
    });
  }

  // "Auf Standard zurücksetzen": delete the override so the Art falls back to the
  // shared global default. Only offered for an angepasst row.
  openResetDialog(row: NormRow): void {
    if (!row.is_override || !row.override_id) {
      return;
    }
    const overrideId = row.override_id;
    const ref = this.dialog.open<ConfirmDialogComponent, ConfirmDialogData, boolean>(
      ConfirmDialogComponent,
      {
        data: {
          title: 'Auf Standard zurücksetzen?',
          message:
            `Die angepasste Artennorm für „${row.species_name}“ wird gelöscht. ` +
            'Die Art verwendet danach wieder die Standard-Artennorm.',
          confirmLabel: 'Auf Standard zurücksetzen',
        },
        width: '480px',
      },
    );
    ref.afterClosed().subscribe((confirmed) => {
      if (!confirmed) {
        return;
      }
      this.api.deleteSpeciesNormOverride(overrideId).subscribe({
        next: () => {
          this.snackBar.open(
            `„${row.species_name}“ verwendet wieder die Standard-Artennorm.`,
            'Schließen',
            {duration: 3000},
          );
          this.load();
        },
        error: (err: HttpErrorResponse) =>
          this.snackBar.open(this.errorMessage(err, 'zurückgesetzt'), 'Schließen', {duration: 5000}),
      });
    });
  }

  private errorMessage(err: HttpErrorResponse, verb: string): string {
    const body = err.error as {detail?: string} | undefined;
    return body?.detail ?? `Artennorm konnte nicht ${verb} werden.`;
  }

  // The list marks each Art Standard vs angepasst by joining the effective norms
  // (every Art in force) with the Organisation's overrides (the angepasst set),
  // mirroring how Beringer verwalten joins /scientists/ with /mitgliedschaften/.
  private load(): void {
    this.loading.set(true);
    forkJoin({
      effective: this.api.getEffectiveSpeciesNorms(),
      overrides: this.api.getAllSpeciesNormOverrides(),
    }).subscribe({
      next: ({effective, overrides}) => {
        const overrideBySpecies = new Map(overrides.map((o) => [o.species_id, o]));
        this.rows.set(
          effective.norms.map((norm) => {
            const override = overrideBySpecies.get(norm.species_id) ?? null;
            return {
              species_id: norm.species_id,
              species_name: norm.species_name,
              is_override: override !== null,
              override_id: override?.id ?? null,
              norm,
            };
          }),
        );
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.snackBar.open('Artennormen konnten nicht geladen werden.', 'Schließen', {
          duration: 3000,
        });
      },
    });
  }
}
