import {Type} from '@angular/core';
import {ComponentFixture} from '@angular/core/testing';
import {By} from '@angular/platform-browser';

/**
 * Wie eine Spec den Icon-Seam prüft (#439, ADR 0037) — am **gezeichneten
 * Ergebnis**, nie am Marker im Template.
 *
 * Der Unterschied ist nicht kosmetisch. `<mat-icon app-icon-empty>` ins Template
 * zu schreiben und `AppIconEmptyDirective` im `imports`-Array der Komponente zu
 * vergessen ist für Angular **kein Fehler**: ein unbekanntes Attribut auf einem
 * bekannten Element wird stillschweigend hingenommen. Im Browser stünde dann ein
 * leeres `<mat-icon></mat-icon>` — kein Glyph, kein Bild, nichts —, während
 * `querySelector('mat-icon[app-icon-empty]')` fröhlich ein Element zurückgäbe
 * und die Spec grün bliebe. Eine solche Spec liest bloß das Attribut zurück, das
 * das Template selbst hineingeschrieben hat, und beweist nichts.
 *
 * Also: `renderedGlyph()` fragt, ob etwas gezeichnet wurde, und `seamGlyph()`
 * fragt, ob es die *benannte* Direktive war, die es gezeichnet hat.
 */

/**
 * Das Glyph, das ein `<mat-icon>` tatsächlich auf den Bildschirm bringt —
 * `''`, wenn es leer bleibt.
 *
 * Kennt beide Hinterlegungsarten, damit die Specs das Einwechseln der
 * gezeichneten Vögel überleben: eine Material-Ligatur landet als Text im
 * Element, ein `svgIcon` als eingebettetes `<svg>`. Was genau dort steht, prüft
 * absichtlich niemand — nur *dass* dort etwas steht.
 *
 * **Zurückgegeben wird in beiden Fällen das Gezeichnete selbst, nie sein Name**
 * (#514). Ein `<mat-icon svgIcon>` trägt seinen Registry-Namen als
 * `data-mat-icon-name` am Element; ihn hier zu bevorzugen wäre bequemer zu
 * lesen und würde die eine Zusicherung zerstören, für die diese Funktion
 * gebaut ist: `glyph(a) !== glyph(b)` vergliche dann zwei Konstanten, die sich
 * per Konstruktion unterscheiden — auch dann, wenn hinter beiden Namen
 * dieselbe Zeichnung steht. „Der leere und der kaputte Zustand bekommen
 * verschiedene Vögel" (ADR 0037) wäre unbeobachtet.
 */
export function renderedGlyph(icon: Element | null | undefined): string {
  if (!icon) return '';
  const svg = icon.querySelector('svg');
  if (svg) return svg.outerHTML;
  return icon.textContent?.trim() ?? '';
}

/**
 * Das Glyph, das die Seam-Direktive `directive` in diesem Fixture gezeichnet hat
 * — `''`, wenn die Direktive überhaupt nicht greift (fehlender
 * `imports`-Eintrag) oder nichts zeichnet.
 *
 * `By.directive()` findet nur, was Angular wirklich instanziiert hat. Damit
 * unterscheidet die Spec auch, *welcher* der beiden Namen am Element hängt: der
 * leere Zustand darf nicht versehentlich das Icon des kaputten tragen.
 */
export function seamGlyph(fixture: ComponentFixture<unknown>, directive: Type<unknown>): string {
  const found = fixture.debugElement.query(By.directive(directive));
  return renderedGlyph(found?.nativeElement as Element | undefined);
}
