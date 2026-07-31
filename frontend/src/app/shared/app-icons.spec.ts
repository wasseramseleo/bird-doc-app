import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconModule } from '@angular/material/icon';

import { AppIconEmptyDirective, AppIconErrorDirective } from './app-icons';
import { renderedGlyph } from './app-icons.testing';

/**
 * Das Host-Template benennt bewusst **keine** Glyphe — beide `<mat-icon>` sind
 * leer. Alles, was hier gerendert ankommt, kann nur aus dem Seam stammen.
 */
@Component({
  imports: [MatIconModule, AppIconErrorDirective, AppIconEmptyDirective],
  template: `
    <mat-icon app-icon-error aria-hidden="true"></mat-icon>
    <mat-icon app-icon-empty aria-hidden="true"></mat-icon>
  `,
})
class HostComponent {}

/**
 * Diese Spec nennt die Hinterlegung an keiner Stelle. Sie prüft, *dass*
 * gezeichnet wird und dass die beiden Zustände verschieden aussehen — nicht,
 * *was* dahintersteht. Genau deshalb überlebt sie das Einwechseln der
 * gezeichneten Vögel (`svgIcon` statt Ligatur), das in `app-icons.ts` zwei
 * Zeilen ist: „Einwechseln ist eine Datei" wäre sonst schon durch diese Datei
 * widerlegt.
 */
describe('Icon-Seam (app-icon-error / app-icon-empty)', () => {
  let fixture: ComponentFixture<HostComponent>;

  const glyph = (selector: string) =>
    renderedGlyph(fixture.nativeElement.querySelector(selector) as Element | null);

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('zeichnet dem kaputten Zustand ein Icon, ohne dass das Template eines benennt', () => {
    expect(glyph('mat-icon[app-icon-error]')).toBeTruthy();
  });

  it('zeichnet dem leeren Zustand ein Icon, ohne dass das Template eines benennt', () => {
    expect(glyph('mat-icon[app-icon-empty]')).toBeTruthy();
  });

  // ADR 0037: „Der leere und der kaputte Zustand bekommen verschiedene Vögel."
  // Bis die Zeichnungen da sind, stehen zwei *verschiedene* Material-Icons dahinter.
  it('unterscheidet den leeren vom kaputten Zustand', () => {
    expect(glyph('mat-icon[app-icon-error]')).not.toEqual(glyph('mat-icon[app-icon-empty]'));
  });

  // Der Seam ist die eine Stelle: das Template setzt keinen Text, die Direktive
  // tut es — und lässt ihn stehen.
  it('lässt das Icon auch dann stehen, wenn erneut geprüft wird', () => {
    const error = glyph('mat-icon[app-icon-error]');
    const empty = glyph('mat-icon[app-icon-empty]');

    fixture.detectChanges();

    expect(glyph('mat-icon[app-icon-error]')).toBe(error);
    expect(glyph('mat-icon[app-icon-empty]')).toBe(empty);
  });
});
