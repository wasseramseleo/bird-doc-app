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
import {MatIconModule} from '@angular/material/icon';
import {MatButtonModule} from '@angular/material/button';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {MatDialog} from '@angular/material/dialog';
import {MatSnackBar} from '@angular/material/snack-bar';

import {DataAccessFacadeService} from '../service/data-access-facade.service';
import {OutboxService} from '../service/outbox.service';
import {ProjectService} from '../service/project.service';
import {ReferenceBundleCacheService} from '../core/offline/reference-bundle-cache';
import {DataEntry} from '../models/data-entry.model';
import {OfflineBundle} from '../models/offline-bundle.model';
import {OutboxEntry} from '../models/outbox-entry.model';
import {DetailDialogOpener} from '../shared/detail-dialog/detail-dialog-opener';
import {
  NICHT_AUF_DIESEM_GERAET_BEKANNT,
  lesemodellAusEintrag,
} from '../shared/detail-dialog/fang-lesemodell';
import {getBirdStatusLabel} from '../data-entry-form/data-entry-labels';
import {ConfirmDialogComponent, ConfirmDialogData} from '../shared/confirm-dialog/confirm-dialog';
import {AppIconErrorDirective} from '../shared/app-icons';
import {FangZeileDirective} from '../shared/directives/fang-zeile';
import {FailureBannerComponent} from '../shared/failure-banner/failure-banner';
import {appFailureOf} from '../core/errors/app-failure';
import {SchreibFehler} from '../core/errors/schreib-fehler';

interface QueuedRow {
  id: string;
  timestamp: string;
  speciesLabel: string;
  ringLabel: string;
  statusLabel: string;
  staffLabel: string;
  // The server's rejection message when this queued entry was skipped-and-
  // flagged during sync (issue #164); `null` for a plain, not-yet-synced
  // capture. A flagged row is highlighted and opens in the form to be fixed.
  syncError: string | null;
  // #495: der Eintrag selbst, weil der Zeilenklick ihn jetzt dem geteilten
  // Öffner hinhält — der macht daraus das Lesemodell des Detail-Dialogs.
  entry: OutboxEntry;
}

/**
 * "Today's session" (issue #163, PRD #152): the Mitglied's review surface for
 * the current Projekt's captures made today — both nicht synchronisiert
 * (queued, this device only) and already synchronisiert (from the server,
 * cached for offline reading). A queued entry can still be edited in the normal
 * capture form (which re-queues it, `DataEntryFormComponent`'s queued-edit mode)
 * or deleted outright.
 *
 * #494 (PRD #491, ADR 0042): eine **synchronisierte** Zeile öffnet den
 * Detail-Dialog — online wie offline, dieselbe Geste wie in „Letzte Fänge" und
 * in der Wiederfang-Historie. Dass ein synchronisierter Fang offline nicht
 * bearbeitbar ist (append-only, PRD #152), sagt der „Bearbeiten"-Knopf im
 * Dialog (#493) und nicht mehr die Zeile.
 *
 * #495: die **nicht synchronisierte** Zeile tut jetzt dasselbe. Damit hört
 * „Heute" auf, ein Sonderfall zu sein: beide Abschnitte öffnen beim Zeilenklick
 * denselben Dialog, und der Weg in die Warteschlangen-Bearbeitung führt von dort
 * über „Bearbeiten" — unverändert, nur einen Schritt später.
 */
@Component({
  selector: 'app-today-session',
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    AppIconErrorDirective,
    FangZeileDirective,
    FailureBannerComponent,
  ],
  templateUrl: './today-session.html',
  styleUrl: './today-session.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TodaySessionComponent implements OnInit {
  private readonly dataAccess = inject(DataAccessFacadeService);
  private readonly outbox = inject(OutboxService);
  private readonly projectService = inject(ProjectService);
  private readonly referenceCache = inject(ReferenceBundleCacheService);
  private readonly dialog = inject(MatDialog);
  private readonly detailDialog = inject(DetailDialogOpener);
  private readonly snackBar = inject(MatSnackBar);

  readonly currentProject = this.projectService.currentProject;
  // #494: die Verbindung entscheidet hier nichts mehr. Ob ein synchronisierter
  // Fang gerade bearbeitbar ist, weiß der geteilte Öffner und sagt der
  // „Bearbeiten"-Knopf im Dialog (#493) — dieser Bildschirm fragt nicht danach.
  // #469: beide Zweige dieses Bildschirms holen das Wort am selben Ort — der
  // synchronisierte im Template, der nicht synchronisierte in `toQueuedRow`.
  // Das Template braucht das Enum seither nicht mehr; es entscheidet nichts
  // mehr über den Ringstatus, es zeigt nur noch, was die Beschriftung sagt.
  readonly getBirdStatusLabel = getBirdStatusLabel;

  readonly loadingSynced = signal(false);
  readonly syncedEntries = signal<DataEntry[]>([]);

  // #448 (ADR 0037): auch hier ist das Löschen eine ausgelöste Schreibung — sie
  // landet im Banner und bleibt dort, statt drei Sekunden zu toasten. Die
  // Erfolgsmeldung bleibt die Snackbar.
  readonly schreibFehler = new SchreibFehler();

  // Best-effort, read once on init: the cached offline reference bundle
  // (issue #158) resolves a queued entry's flat write-shape payload back to
  // display-ready species/Station/Beringer names — see `lesemodellAusEintrag`,
  // das dafür dieselbe Auflösung benutzt wie die Erfassungsmaske (#495).
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

  // #495: die Zeile liest denselben Fang wie der Dialog, den sie öffnet — über
  // dasselbe Lesemodell. Eine Referenz, die dieses Gerät nicht auflösen kann,
  // heißt deshalb hier wortgleich wie dort „auf diesem Gerät nicht bekannt";
  // sonst widerspräche der Bildschirm dem Dialog, den er aufmacht.
  private toQueuedRow(entry: OutboxEntry): QueuedRow {
    const fang = lesemodellAusEintrag(entry, this.cachedBundle());
    return {
      id: entry.id,
      timestamp: entry.queuedAt,
      speciesLabel: fang.species?.common_name_de ?? NICHT_AUF_DIESEM_GERAET_BEKANNT,
      // Ringgröße und Ringnummer liegen flach im Payload — kein Nachschlagen,
      // also auch keine ausgefallene Auflösung, die zu benennen wäre.
      ringLabel: fang.ring ? `${fang.ring.size} ${fang.ring.number}` : '—',
      // #469: derselbe Ort wie auf jeder anderen Fang-Oberfläche. Ein
      // Ring-vernichtet-Eintrag trägt schon in der Outbox keinen Ringstatus —
      // die Beschriftung macht daraus einen Gedankenstrich, keinen Wiederfang.
      statusLabel: getBirdStatusLabel(fang.bird_status),
      staffLabel: fang.staff?.full_name ?? NICHT_AUF_DIESEM_GERAET_BEKANNT,
      syncError: entry.syncError ?? null,
      entry,
    };
  }

  // #495 (PRD #491, ADR 0042): auch die **nicht synchronisierte** Zeile öffnet
  // den Detail-Dialog — damit hört „Heute" auf, zwei Sorten Zeilen mit zwei
  // Sorten Verhalten zu sein. Bis hierher navigierte sie direkt in die
  // Warteschlangen-Bearbeitung (#163); dorthin führt jetzt der
  // „Bearbeiten"-Knopf im Dialog, auf demselben Weg wie zuvor.
  //
  // Das Lesemodell baut der geteilte Öffner; dieser Bildschirm reicht ihm nur
  // den Eintrag und das, was er vom Gerät weiß.
  openQueued(row: QueuedRow): void {
    this.detailDialog.openQueued(row.entry, this.cachedBundle());
  }

  // #494 (PRD #491, ADR 0042): eine Zeile antippen heißt „zeig mir diesen Fang" —
  // online wie offline, ohne Fallunterscheidung. Bis hierher navigierte diese
  // Zeile online in die Bearbeitungsmaske und fiel nur offline auf den Dialog
  // zurück; die Beringer:in musste wissen, ob das Gerät gerade Empfang hat,
  // bevor sie tippt.
  //
  // Die Regel dahinter geht nicht verloren, sie wandert nur: ein
  // synchronisierter Fang ist offline nicht bearbeitbar (append-only,
  // PRD #152) — das sagt seit #493 der „Bearbeiten"-Knopf im Dialog, sichtbar,
  // gesperrt und mit Grund. Entschieden wird es im geteilten Öffner, nicht
  // hier: diese Tabelle sagt nur, *dass* es dieser Fang ist.
  openSynced(entry: DataEntry): void {
    this.detailDialog.open(entry);
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
      this.deleteQueuedEntry(row.id);
    });
  }

  private deleteQueuedEntry(id: string): void {
    this.schreibFehler.leeren();
    this.outbox.delete(id).subscribe({
      next: () => this.snackBar.open('Eintrag wurde gelöscht.', undefined, {duration: 2000}),
      error: (err: unknown) =>
        this.schreibFehler.zeige(appFailureOf(err), () => this.deleteQueuedEntry(id)),
    });
  }
}
