import {Injectable, inject} from '@angular/core';
import {MatDialog, MatDialogRef} from '@angular/material/dialog';

import {DataEntryDetailDialogComponent} from './data-entry-detail-dialog';
import {DataEntry} from '../../models/data-entry.model';

/**
 * #478 (ADR 0042): „öffne den Detail-Dialog zu diesem Fang" — mehr tut diese
 * Einheit nicht, und niemand sonst tut es.
 *
 * Die Regel, die dahinter steht, lautet: das **Detail-Zeichen** (ⓘ) führt in
 * *jeder* Fang-Tabelle zum Detail-Dialog. Sie liegt dadurch an genau einer
 * Stelle — die geteilte `MarkerSlotsComponent` benutzt diesen Öffner, und eine
 * Tabelle kann die Regel gar nicht erst falsch verdrahten. Genau das war in
 * #478 passiert: „Letzte Fänge" navigierte in die Bearbeitungsmaske, während
 * das ⓘ mit einem Merkmal warb, das dieser Bildschirm ausblendet (ADR 0035).
 *
 * Die Dialog-Konfiguration steht **nur hier**. Vor #478 stand sie wortgleich an
 * zwei Stellen (`DataEntryFormComponent.openDetailDialog()` und
 * `TodaySessionComponent.openSynced()`); mit dem dritten Aufrufer wären daraus
 * drei Kopien geworden statt null.
 */
@Injectable({providedIn: 'root'})
export class DetailDialogOpener {
  private readonly dialog = inject(MatDialog);

  open(entry: DataEntry): MatDialogRef<DataEntryDetailDialogComponent> {
    return this.dialog.open(DataEntryDetailDialogComponent, {
      data: entry,
      width: '640px',
      maxHeight: '90vh',
    });
  }
}
