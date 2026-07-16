import {ChangeDetectionStrategy, Component, inject} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import {MAT_DIALOG_DATA, MatDialogModule} from '@angular/material/dialog';
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
import {environment} from '../../../environments/environment';
import {getAgeClassLabel, getSexLabel} from '../data-entry-labels';

@Component({
  selector: 'app-data-entry-detail-dialog',
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, DatePipe],
  templateUrl: './data-entry-detail-dialog.html',
  styleUrls: ['./data-entry-detail-dialog.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataEntryDetailDialogComponent {
  readonly entry: DataEntry = inject(MAT_DIALOG_DATA);
  readonly BirdStatus = BirdStatus;

  getStatusLabel(status: BirdStatus): string {
    return status === BirdStatus.FirstCatch ? 'Erstfang' : 'Wiederfang';
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

  openInBackend(): void {
    window.open(`${environment.adminUrl}/birds/dataentry/${this.entry.id}/change/`, '_blank');
  }
}
