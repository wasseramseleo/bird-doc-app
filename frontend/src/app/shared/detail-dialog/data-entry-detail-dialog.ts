import {ChangeDetectionStrategy, Component, Signal, inject} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import {MAT_DIALOG_DATA, MatDialogModule, MatDialogRef} from '@angular/material/dialog';
import {MatButtonModule} from '@angular/material/button';
import {MatIconModule} from '@angular/material/icon';
import {
  AgeClass,
  BirdStatus,
  DataEntry,
  Direction,
  FatClass,
  HandWingMoult,
  MuscleClass,
  Parasit,
  PARASIT_LABELS,
  Sex,
  SmallFeatherAppMoult,
  SmallFeatherIntMoult,
} from '../../models/data-entry.model';
import {
  getAgeClassLabel,
  getBirdStatusLabel,
  getSexLabel,
} from '../../data-entry-form/data-entry-labels';

/**
 * #493 (PRD #491): ob „Bearbeiten" angeboten oder **gesperrt** ist — und wenn
 * gesperrt, warum. Entschieden wird das im geteilten Öffner; hier steht nur, was
 * der Dialog davon zu zeigen hat.
 */
export interface BearbeitenAngebot {
  readonly gesperrt: boolean;
  /** Der Satz, der sagt warum und wann wieder — `null`, solange nichts sperrt. */
  readonly grund: string | null;
}

/**
 * #493: womit der geteilte Öffner den Detail-Dialog aufmacht — der Fang, das
 * Angebot „Bearbeiten" und wohin es führt. Der Dialog entscheidet davon nichts:
 * er zeigt den Fang, zeigt das Angebot und ruft zurück. Dadurch kann keine
 * Tabelle die Regel anders verdrahten (ADR 0042).
 */
export interface DetailDialogDaten {
  readonly fang: DataEntry;
  /**
   * Ein Signal, weil die Sperre der **Reichweite des Geräts** gilt und nicht dem
   * Alter des Fangs: kommt die Verbindung wieder, wird der Knopf im offenen
   * Dialog sofort wieder auslösbar.
   */
  readonly bearbeiten: Signal<BearbeitenAngebot>;
  /** Der Weg hinaus — er führt aus dem Dialog, er ändert nichts darin. */
  readonly bearbeiteFang: () => void;
}

/** Genau eine Begründung je Dialog, damit `aria-describedby` eindeutig zeigt. */
let grundZaehler = 0;

/**
 * #478 (ADR 0042): der **Detail-Dialog** — der vollständige, schreibgeschützte
 * Datensatz eines Fangs. Er zeigt *jedes* Merkmal, auch eines, das das Projekt
 * über die Optionalen Felder abgeschaltet hat (ADR 0035), und ist damit das
 * Einzige, was das Versprechen des Detail-Zeichens in jedem Projekt einlöst.
 *
 * Er liegt in `shared/`, weil er nie dem Erfassungsformular gehörte: „Letzte
 * Fänge", die Wiederfang-Historie und „Heute" (offline) führen alle hierher.
 * Geöffnet wird er ausschließlich über den `DetailDialogOpener` daneben — der
 * kennt als Einziger die Dialog-Konfiguration.
 *
 * #493 (PRD #491): sein einziger weiterführender Knopf heißt **„Bearbeiten"**
 * und führt in die Bearbeitungsmaske des gezeigten Fangs. „Im Backend öffnen"
 * ist ersatzlos weg — Django ist ein Werkzeug für Admins, die Navigationsleiste
 * zeigt den Zugang bewusst nur hinter dem Staff-Recht, und hier endete er für
 * alle anderen an einer Rechtewand. Schreibgeschützt bleibt der Dialog
 * trotzdem: „Bearbeiten" führt **hinaus**, es ändert nichts an Ort und Stelle.
 *
 * Ob der Knopf angeboten oder gesperrt ist, mit welcher Begründung, und wohin er
 * führt, entscheidet der Öffner — hier steht nur, wie es aussieht und wie ein
 * Screenreader es erfährt.
 */
@Component({
  selector: 'app-data-entry-detail-dialog',
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, DatePipe],
  templateUrl: './data-entry-detail-dialog.html',
  styleUrls: ['./data-entry-detail-dialog.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataEntryDetailDialogComponent {
  private readonly daten: DetailDialogDaten = inject(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<DataEntryDetailDialogComponent>>(MatDialogRef);

  readonly entry: DataEntry = this.daten.fang;
  readonly bearbeiten = this.daten.bearbeiten;
  /** Die Id, über die `aria-describedby` des Knopfes seine Begründung findet. */
  readonly grundId = `bearbeiten-grund-${++grundZaehler}`;
  readonly BirdStatus = BirdStatus;

  // #469: derselbe Ort wie für Alter und Geschlecht darunter. Ein Ring
  // vernichtet hat keinen Ringstatus — das Backend leert ihn —, und das
  // Beschriftungsmodul macht daraus einen Gedankenstrich.
  getStatusLabel(status: BirdStatus | null): string {
    return getBirdStatusLabel(status);
  }

  // #232 (US 19): the ring's Zentrale, so a foreign recapture is recognizable in
  // the record. Shows the scheme name + EURING code; an entry with no stored
  // Zentrale (pre-field data) reads as a dash.
  getCentralLabel(): string {
    const central = this.entry.ring?.central;
    return central ? `${central.name} (${central.scheme_code})` : '—';
  }

  // #115: the Alter/Geschlecht labels are shared with the "Bisherige Fänge"
  // summary in the capture form via data-entry-labels — one source of truth.
  getAgeClassLabel(value: AgeClass | null): string {
    return getAgeClassLabel(value);
  }

  getSexLabel(value: Sex | null): string {
    return getSexLabel(value);
  }

  getDirectionLabel(value: Direction | null): string {
    if (!value) return '—';
    return value === Direction.Left ? 'Links' : 'Rechts';
  }

  // Parasit (ADR 0027): the selected parasite types as a comma-separated list of
  // labels, or a dash when none were recorded. Falls back to the raw code for a
  // type not in the vocabulary, so stray data never renders blank.
  getParasitLabels(value: Parasit[] | null | undefined): string {
    if (!value || value.length === 0) return '—';
    return value.map(code => PARASIT_LABELS[code] ?? code).join(', ');
  }

  getFatLabel(value: FatClass | null): string {
    return value !== null && value !== undefined ? String(value) : '—';
  }

  getMuscleLabel(value: MuscleClass | null): string {
    const map: Record<number, string> = {
      [MuscleClass.Null]: '0 – Brustbein gut sichtbar',
      [MuscleClass.One]: '1 – Brustbein gut fühlbar',
      [MuscleClass.Two]: '2 – Brustbein kaum fühlbar',
      [MuscleClass.Three]: '3 – Brustbein nicht fühlbar (konvex)',
    };
    return value !== null && value !== undefined ? (map[value] ?? String(value)) : '—';
  }

  getSmallFeatherIntLabel(value: SmallFeatherIntMoult | null): string {
    const map: Record<number, string> = {
      [SmallFeatherIntMoult.None]: '0 – keine',
      [SmallFeatherIntMoult.Some]: '1 – bis zu 20 Federn',
      [SmallFeatherIntMoult.Many]: '2 – mehr als 20 Federn',
    };
    return value !== null && value !== undefined ? (map[value] ?? String(value)) : '—';
  }

  getSmallFeatherAppLabel(value: SmallFeatherAppMoult | null): string {
    const map: Record<string, string> = {
      [SmallFeatherAppMoult.Juvenile]: 'J – Eben flügger Jungvogel',
      [SmallFeatherAppMoult.Unmoulted]: 'U – Weniger als 1/3 erneuert',
      [SmallFeatherAppMoult.Mixed]: 'M – Zwischen 1/3 und 2/3 erneuert',
      [SmallFeatherAppMoult.New]: 'N – Mehr als 2/3 erneuert',
    };
    return value ? (map[value] ?? String(value)) : '—';
  }

  getHandWingLabel(value: HandWingMoult | null): string {
    const map: Record<number, string> = {
      [HandWingMoult.None]: '0 – Keine Handschwingen wachsen',
      [HandWingMoult.NoneOld]: '1 – Alle sind unvermausert',
      [HandWingMoult.AtLeastOne]: '2 – Mindestens eine mausert',
      [HandWingMoult.All]: '3 – Alle vermausert',
      [HandWingMoult.Part]: '4 – Ein Teil ist vermausert',
    };
    return value !== null && value !== undefined ? (map[value] ?? String(value)) : '—';
  }

  /**
   * #493: der Weg vom Lesen zum Korrigieren. Der Knopf bleibt gesperrt
   * **anfassbar** (`aria-disabled`, kein blankes `disabled`) — deshalb kommt der
   * Klick auch dann hier an, und deshalb muss er hier enden. Sonst wäre der
   * Knopf zwar angekündigt, aber trotzdem auslösbar.
   */
  bearbeiteFang(): void {
    if (this.bearbeiten().gesperrt) {
      return;
    }
    // Erst zumachen, dann gehen: der Dialog liegt sonst über dem Bildschirm,
    // auf dem die Beringer:in gleich korrigiert.
    this.dialogRef.close();
    this.daten.bearbeiteFang();
  }
}
