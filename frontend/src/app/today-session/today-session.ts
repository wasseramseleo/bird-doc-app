import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {CommonModule} from '@angular/common';
import {Router} from '@angular/router';
import {MatIconModule} from '@angular/material/icon';
import {MatButtonModule} from '@angular/material/button';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {MatDialog} from '@angular/material/dialog';
import {MatSnackBar} from '@angular/material/snack-bar';

import {DataAccessFacadeService} from '../service/data-access-facade.service';
import {OutboxService} from '../service/outbox.service';
import {ProjectService} from '../service/project.service';
import {ConnectivityService} from '../core/offline/connectivity';
import {ReferenceBundleCacheService} from '../core/offline/reference-bundle-cache';
import {resolveQueuedEntryDisplay} from '../core/offline/queued-entry-display';
import {BirdStatus, DataEntry} from '../models/data-entry.model';
import {OfflineBundle} from '../models/offline-bundle.model';
import {OutboxEntry} from '../models/outbox-entry.model';
import {
  DataEntryDetailDialogComponent,
} from '../data-entry-form/data-entry-detail-dialog/data-entry-detail-dialog';
import {ConfirmDialogComponent, ConfirmDialogData} from '../shared/confirm-dialog/confirm-dialog';

interface QueuedRow {
  id: string;
  timestamp: string;
  speciesLabel: string;
  ringLabel: string;
  statusLabel: string;
  staffLabel: string;
}

/**
 * "Today's session" (issue #163, PRD #152): the Mitglied's review surface for
 * the current Projekt's captures made today — both nicht synchronisiert
 * (queued, this device only) and already synchronisiert (from the server,
 * cached for offline reading). A queued entry opens in the normal capture
 * form for editing (which re-queues it, `DataEntryFormComponent`'s
 * queued-edit mode) or can be deleted outright; a synced entry is always
 * read-only offline (the append-only design — PRD #152's "Out of Scope") and
 * opens in the ordinary edit form only while online, falling back to the
 * read-only detail dialog while offline.
 */
@Component({
  selector: 'app-today-session',
  imports: [CommonModule, MatIconModule, MatButtonModule, MatProgressSpinnerModule],
  templateUrl: './today-session.html',
  styleUrl: './today-session.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TodaySessionComponent implements OnInit {
  private readonly dataAccess = inject(DataAccessFacadeService);
  private readonly outbox = inject(OutboxService);
  private readonly projectService = inject(ProjectService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly referenceCache = inject(ReferenceBundleCacheService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly currentProject = this.projectService.currentProject;
  readonly isOffline = this.connectivity.isOffline;
  readonly BirdStatus = BirdStatus;

  readonly loadingSynced = signal(false);
  readonly syncedEntries = signal<DataEntry[]>([]);

  // Best-effort, read once on init: the cached offline reference bundle
  // (issue #158) resolves a queued entry's flat write-shape payload back to
  // display-ready species/Station/Beringer names — see
  // `resolveQueuedEntryDisplay`.
  private readonly cachedBundle = signal<OfflineBundle | null>(null);

  // Scoped to the active Projekt, mirroring `syncedEntries` (issue #163
  // review fix): a queued entry always carries the `project_id` it was
  // created under (`DataEntryFormComponent.transformFromForm()` — a create
  // requires an active Projekt), so without this filter switching the
  // active Projekt would mix every Projekt the account has ever queued for
  // into whichever Projekt happens to be selected, letting a capture be
  // opened/edited/deleted from the wrong Projekt's session view.
  readonly queuedRows = computed<QueuedRow[]>(() => {
    const projectId = this.currentProject()?.id;
    if (!projectId) {
      return [];
    }
    return this.outbox
      .pendingEntries()
      .filter((entry) => entry.payload['project_id'] === projectId)
      .map((entry) => this.toQueuedRow(entry));
  });

  constructor() {
    // Reactive load, mirroring DataEntryListComponent: tracks only the
    // active Projekt, so both the first render and a Projekt switch (even
    // reusing this same route/component instance) refresh the synced list.
    // The body is untracked so loadSynced()'s own signal writes don't
    // re-trigger this effect.
    effect(() => {
      const project = this.currentProject();
      untracked(() => {
        if (project) {
          this.loadSynced(project.id);
        } else {
          this.syncedEntries.set([]);
        }
      });
    });
  }

  ngOnInit(): void {
    this.referenceCache
      .load()
      .then((cached) => this.cachedBundle.set(cached?.bundle ?? null))
      .catch((error: unknown) => console.error('Failed to read the offline reference cache', error));
  }

  private loadSynced(projectId: string): void {
    this.loadingSynced.set(true);
    this.dataAccess.getTodayEntries(projectId).subscribe({
      next: (entries) => {
        this.syncedEntries.set(entries);
        this.loadingSynced.set(false);
      },
      error: () => {
        this.syncedEntries.set([]);
        this.loadingSynced.set(false);
      },
    });
  }

  private toQueuedRow(entry: OutboxEntry): QueuedRow {
    const display = resolveQueuedEntryDisplay(entry.payload, this.cachedBundle());
    const ringSize = entry.payload['ring_size'];
    const ringNumber = entry.payload['ring_number'];
    return {
      id: entry.id,
      timestamp: entry.queuedAt,
      speciesLabel: display.species?.common_name_de ?? '—',
      ringLabel: ringSize && ringNumber ? `${ringSize} ${ringNumber}` : '—',
      statusLabel: entry.payload['bird_status'] === BirdStatus.FirstCatch ? 'Erstfang' : 'Wiederfang',
      staffLabel: display.staff?.full_name ?? '—',
    };
  }

  // Issue #163: entry-detail navigation resolves both server IDs and local
  // outbox IDs to the same form — a queued row's id is its outbox id, which
  // `DataEntryFormComponent` resolves via `OutboxService.findQueued()`.
  openQueued(row: QueuedRow): void {
    this.router.navigate(['/data-entry', row.id]);
  }

  // A synced entry is always read-only offline (no offline edits to server
  // rows — PRD #152's append-only design): opening it offline shows the
  // ordinary read-only detail dialog instead of the editable form.
  openSynced(entry: DataEntry): void {
    if (this.isOffline()) {
      this.dialog.open(DataEntryDetailDialogComponent, {
        data: entry,
        width: '640px',
        maxHeight: '90vh',
      });
      return;
    }
    this.router.navigate(['/data-entry', entry.id]);
  }

  deleteQueued(row: QueuedRow, event: Event): void {
    event.stopPropagation();
    const ref = this.dialog.open<ConfirmDialogComponent, ConfirmDialogData, boolean>(
      ConfirmDialogComponent,
      {
        data: {
          title: 'Eintrag löschen?',
          message: 'Der nicht synchronisierte Eintrag wird endgültig gelöscht.',
          confirmLabel: 'Löschen',
          cancelLabel: 'Abbrechen',
        },
        width: '420px',
      },
    );
    ref.afterClosed().subscribe((confirmed) => {
      if (!confirmed) {
        return;
      }
      this.outbox.delete(row.id).subscribe({
        next: () =>
          this.snackBar.open('Eintrag wurde gelöscht.', undefined, {duration: 2000}),
        error: () =>
          this.snackBar.open('Eintrag konnte nicht gelöscht werden.', 'Schließen', {
            duration: 3000,
          }),
      });
    });
  }
}
