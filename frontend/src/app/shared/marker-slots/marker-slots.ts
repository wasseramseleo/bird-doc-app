import {ChangeDetectionStrategy, Component, computed, inject, input} from '@angular/core';
import {MatIconModule} from '@angular/material/icon';

import {DataEntry} from '../../models/data-entry.model';
import {DetailDialogOpener} from '../detail-dialog/detail-dialog-opener';

/**
 * #388/#405: die Marker-Zelle der Fang-Tabellen — drei feste Slots in fixer
 * Reihenfolge (ⓘ Detail-Zeichen │ ♥ Tot-Fund │ ⚑ Nicht-Standard-Fang). Ein
 * Marker sitzt dadurch in jeder Zeile an derselben x-Position und die Spalte
 * lässt sich vertikal nach Auffälligem abscannen; ein leerer Slot behält seine
 * Breite und rückt nicht nach. Ein Fang kann beide Fangmarker zugleich tragen
 * (ADR 0026), alle drei Slots sind also gleichzeitig belegbar.
 *
 * **Zwei Slots tragen Information, einer trägt eine Handlung** (#478, ADR 0042).
 * ♥ und ⚑ bleiben passiv: sie schlucken ihren Klick nicht, er steigt zur Zeile
 * auf, und was die Zeile damit tut, ist Sache der Tabelle (#405: „die Zeile
 * trägt den Klick, die Spalte trägt nur Information"). Das **Detail-Zeichen**
 * ist die benannte Ausnahme — ein `button`, der den Detail-Dialog öffnet und
 * seinen Klick schluckt. Diese Komponente ist damit **nicht mehr rein
 * präsentational**; wer sie dorthin zurückbaut, stellt #478 wieder her.
 *
 * #468: das ⓘ bedeutet **nicht** „hat Bemerkung", sondern „in dieser Zeile
 * steht mehr, als die Spalten zeigen — antippen". Es erscheint deshalb auch bei
 * gesetztem **Brutfleck** oder **CPL+**, die in keiner der beiden Tabellen eine
 * Spalte haben: ohne das Zeichen wüsste die Beringer:in beim Wiederfang nicht
 * einmal, dass es etwas zu erfahren gibt.
 *
 * #478: das „antippen" wird jetzt auch eingelöst. Ein natives `title` hat
 * keinerlei Touch-Verhalten — auf dem Tablet, dem Fall für den das Antippen
 * gedacht war, ist der Tap der einzige Weg, und er führte in „Letzte Fänge" in
 * die Bearbeitungsmaske, die ein vom Projekt abgeschaltetes Merkmal ausblendet
 * (ADR 0035). Das Ziel ist deshalb der **Detail-Dialog**, der als Einziges
 * *jedes* Merkmal führt; geöffnet über den geteilten `DetailDialogOpener`,
 * damit keine Tabelle die Regel anders verdrahten kann.
 *
 * Tooltip und Screenreader-Beschriftung tragen **denselben** beschrifteten Text
 * (`bemerkenswertes`): die Vokabeln zuerst, die freie Bemerkung ausdrücklich als
 * „Bemerkung: …" dahinter. Die Kennzeichnung ist nicht Zierde — ein Tot-Fund
 * komponiert seinen Bemerkungstext selbst („Totfund; Umstände: Katze") und würde
 * sonst wie eine weitere Vokabel gelesen.
 *
 * **Keine Projekt-Kopplung:** das ⓘ nennt, was der *Datensatz* trägt, und kennt
 * die Optionale-Felder-Konfiguration nicht (dieselbe Linie wie ADR 0035:
 * darstellend, gespeicherte Werte unangetastet). Ein Projekt, das Brutfleck
 * abgeschaltet hat, sieht den an einem historischen Fang erhobenen Brutfleck
 * also weiterhin — er wurde am Vogel erhoben, nicht am Formular.
 *
 * #405: „Letzte Fänge" und die Wiederfang-Historie konsumieren dieselbe
 * Komponente. Die Kopie ist hier schon einmal gescheitert — `.fangmarker-icon`
 * war zweimal definiert und bereits divergiert. Die `matColumnDef` selbst bleibt
 * bewusst pro Tabelle (Header, Breite, `stickyEnd`): die ist über Material-
 * Tabellen hinweg schlecht teilbar und war auch nicht das, was divergiert ist.
 */
@Component({
  selector: 'app-marker-slots',
  imports: [MatIconModule],
  templateUrl: './marker-slots.html',
  styleUrl: './marker-slots.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkerSlotsComponent {
  private readonly detailDialog = inject(DetailDialogOpener);

  readonly entry = input.required<DataEntry>();

  /**
   * Was in dieser Zeile mehr steht, als die Spalten zeigen — oder `''`, wenn
   * nichts. Leer heißt: kein Detail-Zeichen.
   */
  readonly bemerkenswertes = computed(() => bemerkenswertesAn(this.entry()));

  /**
   * #478 (ADR 0042): der Klick gehört dem Zeichen und geht **nicht** weiter zur
   * Zeile. Stiege er auf, navigierte „Letzte Fänge" zusätzlich in die
   * Bearbeitungsmaske und die Wiederfang-Historie öffnete den Dialog ein
   * zweites Mal — ein Tipp, zwei Wirkungen.
   */
  oeffneDetails(event: Event): void {
    event.stopPropagation();
    this.detailDialog.open(this.entry());
  }
}

/**
 * Die Vokabeln, die das ⓘ nennt — **wortgleich** mit denen, die der IWM-Export
 * in die Melde-Bemerkung schreibt (`backend/birds/iwm_export.py`,
 * `_build_comment`). Die Beringer:in soll für eine Sache nicht zwei Wörter
 * lernen: „CPL+" heißt hier wie dort „CPL+" und nicht „Kloake" (das ist die
 * Spaltenüberschrift der Meldestelle).
 */
const MERKMAL_VOKABELN: readonly {
  readonly gesetzt: (entry: DataEntry) => boolean;
  readonly wort: string;
}[] = [
  {gesetzt: (entry) => entry.has_brood_patch, wort: 'Brutfleck'},
  {gesetzt: (entry) => entry.has_cpl_plus, wort: 'CPL+'},
];

/**
 * Setzt Tooltip und `aria-label` zusammen — jeder Teil nur, wenn vorhanden:
 *
 * | Zutreffend            | Text                                          |
 * |-----------------------|-----------------------------------------------|
 * | nur Merkmale          | `Brutfleck, CPL+`                             |
 * | nur Bemerkung         | `Bemerkung: Ring saß locker`                  |
 * | beides                | `Brutfleck, CPL+ — Bemerkung: Ring saß locker`|
 * | Tot-Fund + Brutfleck  | `Brutfleck — Bemerkung: Totfund; Umstände: Katze` |
 */
function bemerkenswertesAn(entry: DataEntry): string {
  const teile: string[] = [];

  const merkmale = MERKMAL_VOKABELN.filter(({gesetzt}) => gesetzt(entry)).map(({wort}) => wort);
  if (merkmale.length > 0) {
    // Komma-getrennt wie in der Melde-Bemerkung: ohne Trennzeichen läuft
    // „Brutfleck CPL+" für die lesende Person zu einem Wort zusammen.
    teile.push(merkmale.join(', '));
  }

  const bemerkung = entry.comment?.trim();
  if (bemerkung) {
    teile.push(`Bemerkung: ${bemerkung}`);
  }

  return teile.join(' — ');
}
