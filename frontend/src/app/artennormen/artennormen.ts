import {ChangeDetectionStrategy, Component, OnInit, computed, inject, signal} from '@angular/core';
import {HttpErrorResponse} from '@angular/common/http';
import {Observable, forkJoin, of} from 'rxjs';
import {MatButtonModule} from '@angular/material/button';
import {MatIconModule} from '@angular/material/icon';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {MatDialog, MatDialogModule} from '@angular/material/dialog';
import {MatSnackBar, MatSnackBarModule} from '@angular/material/snack-bar';

import {ApiService} from '../service/api.service';
import {
  EffectiveSpeciesNorm,
  SpeciesNormOverride,
  SpeciesRingSizeOverride,
} from '../models/species-norm.model';
import {RingSize} from '../models/ring.model';
import {
  ArtennormDialogResult,
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
  // The Organisation's Empfohlene-Ringgröße overrides (issue #372, ADR 0028),
  // keyed by species_id, so the dialog can pre-fill the current override and the
  // Save can reconcile it (upsert / reset) independently of the norm override.
  private ringOverrideBySpecies = new Map<string, SpeciesRingSizeOverride>();

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
  // the effective values (default or the current override) and from the current
  // Empfohlene-Ringgröße override. Save creates the override (Standard →
  // angepasst) or updates it, and reconciles the ring size independently.
  openEditDialog(row: NormRow): void {
    this.openDialog({
      norm: row.norm,
      ringSize: this.ringOverrideBySpecies.get(row.species_id)?.ring_size ?? null,
    });
  }

  private openDialog(data: ArtennormFormDialogData): void {
    const ref = this.dialog.open<
      ArtennormFormDialogComponent,
      ArtennormFormDialogData,
      ArtennormDialogResult
    >(ArtennormFormDialogComponent, {data, width: '560px'});
    ref.afterClosed().subscribe((result) => {
      if (!result) {
        return;
      }
      // The norm override and the Empfohlene-Ringgröße override are written
      // **independently** (ADR 0028): the norm save is upserted as before, while
      // the ring size is upserted, reset, or left untouched on its own resource.
      forkJoin({
        norm: this.api.saveSpeciesNormOverride(result.norm),
        ring: this.reconcileRingSize(result.norm.species_id, result.ringSize),
      }).subscribe({
        next: ({norm}: {norm: SpeciesNormOverride}) => {
          this.snackBar.open(
            `Artennorm für „${norm.species_name}“ wurde gespeichert.`,
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

  // Reconcile the Empfohlene-Ringgröße override for a species against the chosen
  // value: upsert when set (and changed), delete ("Auf Standard zurücksetzen")
  // when blanked, and do nothing when unchanged — so an unrelated Save never
  // touches the ring size. Null = inherit the global Species.ring_size.
  private reconcileRingSize(speciesId: string, chosen: RingSize | null): Observable<unknown> {
    const existing = this.ringOverrideBySpecies.get(speciesId) ?? null;
    if (chosen) {
      if (existing && existing.ring_size === chosen) {
        return of(null);
      }
      return this.api.saveSpeciesRingSizeOverride({species_id: speciesId, ring_size: chosen});
    }
    if (existing) {
      return this.api.deleteSpeciesRingSizeOverride(existing.id);
    }
    return of(null);
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
      ringOverrides: this.api.getAllSpeciesRingSizeOverrides(),
    }).subscribe({
      next: ({effective, overrides, ringOverrides}) => {
        this.ringOverrideBySpecies = new Map(ringOverrides.map((o) => [o.species_id, o]));
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
