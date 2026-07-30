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

/**
 * Die Hinterlegung der beiden Namen — die eine Stelle, die eine Glyphe kennt.
 *
 * Bewusst ein Objektliteral aus String-Literalen und bewusst exportiert:
 * `scripts/check-icon-seam.mjs` **liest diese Tabelle aus dieser Datei**, statt
 * sie zu wiederholen. Sonst wäre „Einwechseln ist eine Datei" gelogen — nach
 * einem Tausch bewachte der Check weiter die alte Glyphe, würde grün und
 * bewachte nichts mehr. Wer hier tauscht, ändert genau diese zwei Zeilen; Check,
 * Specs und Templates ziehen von allein nach.
 *
 * Der Künstler-Dateiname `icon/keine-fänge` ist nach Fängen benannt, tut hier
 * aber allgemeinen Dienst: „hier ist noch nichts" auf jedem Bildschirm.
 */
export const APP_ICON_BACKINGS = {
  'app-icon-error': 'error_outline',
  'app-icon-empty': 'inbox',
} as const;

/** Der kaputte Zustand. */
@Directive({
  selector: 'mat-icon[app-icon-error]',
  host: {
    '[textContent]': 'backing',
  },
})
export class AppIconErrorDirective {
  readonly backing = APP_ICON_BACKINGS['app-icon-error'];
}

/** Der leere Zustand. */
@Directive({
  selector: 'mat-icon[app-icon-empty]',
  host: {
    '[textContent]': 'backing',
  },
})
export class AppIconEmptyDirective {
  readonly backing = APP_ICON_BACKINGS['app-icon-empty'];
}
