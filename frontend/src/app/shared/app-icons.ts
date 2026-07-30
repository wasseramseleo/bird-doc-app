import { Directive } from '@angular/core';

/**
 * Der Icon-Seam (#439, ADR 0037): „Der leere und der kaputte Zustand bekommen
 * verschiedene Vögel."
 *
 * Zwei benannte App-Icons — `app-icon-error` und `app-icon-empty` — an genau
 * dieser einen Stelle. Ein Template schreibt den Namen an sein `<mat-icon>`:
 *
 *     <mat-icon app-icon-error aria-hidden="true"></mat-icon>
 *     <mat-icon app-icon-empty aria-hidden="true"></mat-icon>
 *
 * ...und kennt die Glyphe dahinter nicht. Bis die gezeichneten Vögel
 * (`icon/error`, `icon/keine-fänge` aus `docs/artist-brief.md`) als SVG
 * vorliegen, stehen Material-Icons dahinter. Das Einwechseln ist dann eine
 * Änderung an dieser Datei — `svgIcon` statt Ligatur, in der Registry
 * hinterlegt — und kein Template wird angefasst. `scripts/check-icon-seam.mjs`
 * hält das repo-weit dicht.
 *
 * Die Direktive setzt den Text des `<mat-icon>`, statt es zu umhüllen: das
 * Element bleibt genau dort, wo es war, und alle bestehenden Regeln der
 * umgebenden Komponente (`.sync-error-banner mat-icon`, `inline="true"`, …)
 * greifen unverändert weiter.
 */

/** Der kaputte Zustand — vorerst hinterlegt mit Material `error_outline`. */
@Directive({
  selector: 'mat-icon[app-icon-error]',
  host: {
    '[textContent]': 'ligature',
  },
})
export class AppIconErrorDirective {
  readonly ligature = 'error_outline';
}

/**
 * Der leere Zustand — vorerst hinterlegt mit Material `inbox`.
 *
 * Der Künstler-Dateiname `icon/keine-fänge` ist nach Fängen benannt, tut hier
 * aber allgemeinen Dienst: „hier ist noch nichts" auf jedem Bildschirm.
 */
@Directive({
  selector: 'mat-icon[app-icon-empty]',
  host: {
    '[textContent]': 'ligature',
  },
})
export class AppIconEmptyDirective {
  readonly ligature = 'inbox';
}
