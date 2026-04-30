import {ChangeDetectionStrategy, Component, inject} from '@angular/core';
import {CommonModule, DatePipe} from '@angular/common';
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
  Sex,
  SmallFeatherAppMoult,
  SmallFeatherIntMoult,
} from '../../models/data-entry.model';
import {environment} from '../../../environments/environment';

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

  getAgeClassLabel(value: AgeClass | null): string {
    const map: Record<number, string> = {
      [AgeClass.Nest]: '1 – Nestling',
      [AgeClass.Unknown]: '2 – Fängling (unbekannt)',
      [AgeClass.ThisYear]: '3 – Diesjährig',
      [AgeClass.NotThisYear]: '4 – Nicht Diesjährig',
      [AgeClass.LastYear]: '5 – Vorjährig',
      [AgeClass.NotLastYear]: '6 – Nicht Vorjährig',
    };
    return value !== null && value !== undefined ? (map[value] ?? String(value)) : '—';
  }

  getSexLabel(value: Sex | null): string {
    const map: Record<number, string> = {
      [Sex.Unknown]: '0 – Unbekannt',
      [Sex.Male]: '1 – Männlich',
      [Sex.Female]: '2 – Weiblich',
    };
    return value !== null && value !== undefined ? (map[value] ?? String(value)) : '—';
  }

  getDirectionLabel(value: Direction | null): string {
    if (!value) return '—';
    return value === Direction.Left ? 'Links' : 'Rechts';
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
