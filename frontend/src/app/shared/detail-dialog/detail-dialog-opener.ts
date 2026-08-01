import {Injectable, computed, inject} from '@angular/core';
import {MatDialog, MatDialogRef} from '@angular/material/dialog';

import {
  BearbeitenAngebot,
  DataEntryDetailDialogComponent,
  DetailDialogDaten,
} from './data-entry-detail-dialog';
import {ConnectivityService} from '../../core/offline/connectivity';
import {FangNavigation} from '../navigation/fang-navigation';
import {DataEntry} from '../../models/data-entry.model';

/**
 * #493: der Satz, der einen verwehrten Weg begleitet — warum gerade nicht, und
 * wann wieder (ADR 0037). Ein synchronisierter Fang ist offline nicht änderbar,
 * weil die Warteschlange nur anhängt und nichts überschreibt (append-only,
 * PRD #152).
 */
export const SYNCHRONISIERT_UND_OFFLINE =
  'Dieser Fang ist bereits synchronisiert und ohne Verbindung nicht bearbeitbar. ' +
  'Sobald das Gerät den Server wieder erreicht, geht es wieder.';

/** Was der Aufrufer über den Fang weiß, das dem Datensatz nicht anzusehen ist. */
export interface FangOeffnenOptionen {
  /**
   * Ob dieser Fang schon oben ist. Voreingestellt `true`: ein `DataEntry` ist
   * ein Server-Datensatz. Ein noch eingereihter Fang (#163) wird ausdrücklich
   * mit `false` geöffnet — er ist auch offline bearbeitbar, das ist der Sinn der
   * Warteschlange.
   */
  readonly synchronisiert?: boolean;
}

/**
 * #478/#493 (ADR 0042, PRD #491): die eine Einheit, die weiß, **was das Öffnen
 * eines Fangs bedeutet** — mehr tut sie nicht, und niemand sonst tut es.
 *
 * Sie kennt
 *
 *   * die Dialog-Konfiguration,
 *   * ob „Bearbeiten" angeboten oder gesperrt wird, und mit welchem Grund,
 *   * und wohin „Bearbeiten" führt — samt Wächter-Umweg.
 *
 * Eine Tabelle ruft nur „öffne diesen Fang" und kann die Regel dadurch gar nicht
 * erst anders verdrahten. Genau das war in #478 passiert: „Letzte Fänge"
 * navigierte in die Bearbeitungsmaske, während das ⓘ mit einem Merkmal warb, das
 * dieser Bildschirm ausblendet (ADR 0035).
 *
 * Die Dialog-Konfiguration stand vor #478 wortgleich an zwei Stellen
 * (`DataEntryFormComponent.openDetailDialog()` und
 * `TodaySessionComponent.openSynced()`); mit dem dritten Aufrufer wären daraus
 * drei Kopien geworden statt null.
 */
@Injectable({providedIn: 'root'})
export class DetailDialogOpener {
  private readonly dialog = inject(MatDialog);
  private readonly connectivity = inject(ConnectivityService);
  private readonly fangNavigation = inject(FangNavigation);

  open(
    fang: DataEntry,
    optionen: FangOeffnenOptionen = {},
  ): MatDialogRef<DataEntryDetailDialogComponent> {
    const synchronisiert = optionen.synchronisiert ?? true;

    // Der Fall ist eng: **nur** synchronisiert und offline. Als Signal, weil die
    // Sperre der Reichweite des Geräts gilt und nicht dem Alter des Fangs —
    // kommt die Verbindung wieder, ist der Knopf im offenen Dialog sofort wieder
    // auslösbar.
    const bearbeiten = computed<BearbeitenAngebot>(() =>
      synchronisiert && this.connectivity.isOffline()
        ? {gesperrt: true, grund: SYNCHRONISIERT_UND_OFFLINE}
        : {gesperrt: false, grund: null},
    );

    return this.dialog.open<DataEntryDetailDialogComponent, DetailDialogDaten>(
      DataEntryDetailDialogComponent,
      {
        data: {
          fang,
          bearbeiten,
          // Der Weg zu einem Fang liegt an einer Stelle (#492): der Wächter läuft
          // **nicht** von selbst, wenn von einem geöffneten Fang zu einem anderen
          // gewechselt wird — für den Router ist das dieselbe Route mit anderer
          // Id. Ohne diesen Umweg täte „Bearbeiten" in der Wiederfang-Historie
          // wortlos nichts.
          bearbeiteFang: () => void this.fangNavigation.zumFang(fang.id),
        },
        width: '640px',
        maxHeight: '90vh',
      },
    );
  }
}
