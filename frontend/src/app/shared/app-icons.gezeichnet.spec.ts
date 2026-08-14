import {Component} from '@angular/core';
import {provideHttpClient} from '@angular/common/http';
import {HttpTestingController, provideHttpClientTesting} from '@angular/common/http/testing';
import {ComponentFixture, TestBed} from '@angular/core/testing';
import {MatIconModule} from '@angular/material/icon';

import {AppIconEmptyDirective, AppIconErrorDirective} from './app-icons';

/**
 * Was der Tausch auf die gezeichneten Vögel zusagt (#514, ADR 0044) und was
 * `app-icons.spec.ts` bewusst nicht prüft: dass es **ohne Netz** eine
 * Zeichnung gibt, dass sie die Farbe der Meldung daneben trägt und dass sie den
 * Platz einnimmt, den vorher die Ligatur einnahm.
 *
 * Die `assets`-Gruppe des Service Workers ist `lazy` — eine Datei landet also
 * erst nach ihrer ersten Anfrage im Zwischenspeicher. Der Fehler-Vogel rendert
 * womöglich zum allerersten Mal offline in einer Feldstation, genau in dem
 * Moment, für den die Fehleroberflächen aus ADR 0037 existieren. Eine
 * Hinterlegung, die ihn dann über HTTP holen will, zeigt ein leeres Kästchen,
 * wenn es am meisten zählt.
 *
 * Die Spec nennt die Hinterlegung an keiner Stelle: sie fragt, *dass* eine
 * Zeichnung ankommt, nie *welche*.
 */
@Component({
  imports: [MatIconModule, AppIconErrorDirective, AppIconEmptyDirective],
  template: `
    <mat-icon app-icon-error aria-hidden="true" style="color: rgb(12, 34, 56)"></mat-icon>
    <mat-icon app-icon-empty aria-hidden="true"></mat-icon>
  `,
})
class HostComponent {}

/**
 * Der Sync-Fehler in „Heute" trägt sein Icon `inline` mitten im Satz — die eine
 * Aufrufstelle, an der die Größe nicht aus dem Stylesheet der Komponente kommt,
 * sondern aus der Schriftgröße ringsum.
 */
@Component({
  imports: [MatIconModule, AppIconErrorDirective],
  template: `
    <span style="display: inline-flex; align-items: center; font-size: 16px; line-height: 1.2">
      <mat-icon inline="true" app-icon-error aria-hidden="true"></mat-icon>
      Sync-Fehler
    </span>
  `,
})
class InlineHostComponent {}

describe('Icon-Seam mit gezeichneten Vögeln', () => {
  let fixture: ComponentFixture<HostComponent>;

  const drawing = (selector: string) =>
    (fixture.nativeElement as Element).querySelector(`${selector} svg`);

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('zeichnet beide Vögel, ohne eine einzige Anfrage hinauszuschicken', () => {
    const anfragen = TestBed.inject(HttpTestingController).match(() => true);

    expect(anfragen.length).toBe(0);
  });

  it('zeichnet den kaputten Zustand als eingebettetes SVG mit echter Geometrie', () => {
    const svg = drawing('mat-icon[app-icon-error]');

    expect(svg).toBeTruthy();
    expect(svg!.querySelectorAll('path, circle, polygon, ellipse').length).toBeGreaterThan(0);
  });

  it('zeichnet den leeren Zustand als eingebettetes SVG mit echter Geometrie', () => {
    const svg = drawing('mat-icon[app-icon-empty]');

    expect(svg).toBeTruthy();
    expect(svg!.querySelectorAll('path, circle, polygon, ellipse').length).toBeGreaterThan(0);
  });

  // ADR 0037: „Der leere und der kaputte Zustand bekommen verschiedene Vögel."
  // Hier steht die Zusicherung am Gezeichneten selbst — zwei Zeichnungen, die
  // sich unterscheiden. `app-icons.spec.ts` sagt dasselbe über die Naht; diese
  // Spec sagt es über das Bild, unabhängig davon, wie eine Hilfsfunktion ein
  // `<mat-icon>` gerade ausliest. Welcher Vogel welcher ist, bleibt auch hier
  // ungenannt: verglichen wird nur, dass es zwei sind.
  it('zeichnet dem leeren Zustand einen anderen Vogel als dem kaputten', () => {
    const kaputt = drawing('mat-icon[app-icon-error]');
    const leer = drawing('mat-icon[app-icon-empty]');

    expect(kaputt!.innerHTML.trim()).toBeTruthy();
    expect(leer!.innerHTML.trim()).toBeTruthy();
    expect(leer!.innerHTML).not.toBe(kaputt!.innerHTML);
  });

  // ADR 0043: die Zeichnung bringt keine eigene Farbe mit, sie erbt die der
  // Meldung daneben — damit Symbol und Satz als ein Hinweis gelesen werden.
  it('trägt die Farbe der Meldung daneben, statt eine eigene mitzubringen', () => {
    const gezeichnet = drawing('mat-icon[app-icon-error]')!.querySelector(
      'path, circle, polygon, ellipse',
    )!;

    expect(getComputedStyle(gezeichnet).fill).toBe('rgb(12, 34, 56)');
  });

  // Eine Ligatur wuchs mit der Schrift, eine Zeichnung nicht: `.mat-icon-inline`
  // vererbt Höhe und Breite, und ein SVG mit `height="100%"` in einem Kasten
  // ohne feste Höhe wird darum sechzehnmal zu groß. Der Sync-Fehler in „Heute"
  // ist die Stelle, an der man das sieht.
  it('bleibt als `inline`-Icon so groß wie der Satz daneben', () => {
    const inlineFixture = TestBed.createComponent(InlineHostComponent);
    inlineFixture.detectChanges();
    const icon = (inlineFixture.nativeElement as Element).querySelector('mat-icon')!;

    const kasten = icon.getBoundingClientRect();

    expect(kasten.width).toBeCloseTo(16, 0);
    expect(kasten.height).toBeCloseTo(16, 0);
  });
});
