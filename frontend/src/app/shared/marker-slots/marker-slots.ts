import {ChangeDetectionStrategy, Component, input} from '@angular/core';
import {MatIconModule} from '@angular/material/icon';

import {DataEntry} from '../../models/data-entry.model';

/**
 * #388/#405: die Marker-Zelle der Fang-Tabellen — drei feste Slots in fixer
 * Reihenfolge (ⓘ Bemerkung │ ♥ Tot-Fund │ ⚑ Nicht-Standard-Fang). Ein Marker
 * sitzt dadurch in jeder Zeile an derselben x-Position und die Spalte lässt sich
 * vertikal nach Auffälligem abscannen; ein leerer Slot behält seine Breite und
 * rückt nicht nach. Ein Fang kann beide Fangmarker zugleich tragen (ADR 0026),
 * alle drei Slots sind also gleichzeitig belegbar.
 *
 * Rein präsentational: Eintrag rein, drei Slots raus — keine Interaktion. Die
 * Zeile trägt den Klick, die Spalte trägt nur Information. Deshalb ist das ⓘ ein
 * passives Icon, dessen bloße Anwesenheit „hat Bemerkung" bedeutet.
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
  readonly entry = input.required<DataEntry>();
}
