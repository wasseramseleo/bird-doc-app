import {Component} from '@angular/core';
import {ComponentFixture, TestBed} from '@angular/core/testing';

import {FangZeileDirective} from './fang-zeile';

/**
 * #496 (PRD #491): die Naht selbst — was eine Fang-Zeile tastaturbedienbar
 * macht, unabhängig davon, welche Tabelle sie trägt. Ob ein Klick zur Zeile
 * aufsteigt, ist dagegen eine Eigenschaft der **Komposition** und hier
 * ausdrücklich **nicht** beweisbar (ADR 0042); dafür liegt in jeder der drei
 * Fang-Tabellen ein eigener Pin.
 */
@Component({
  imports: [FangZeileDirective],
  template: `
    <div appFangZeile data-testid="zeile" (click)="klicks = klicks + 1">
      <span>Kohlmeise</span>
      <button type="button" data-testid="knopf" (click)="knopfKlicks = knopfKlicks + 1">
        Löschen
      </button>
    </div>
  `,
})
class HostComponent {
  klicks = 0;
  knopfKlicks = 0;
}

describe('FangZeileDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let zeile: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({imports: [HostComponent]}).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    zeile = fixture.nativeElement.querySelector('[data-testid="zeile"]') as HTMLElement;
  });

  function taste(key: string, target: HTMLElement = zeile): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {key, bubbles: true, cancelable: true});
    target.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  }

  // Kriterium: „per Tabulator erreichbar". Ohne Tabindex ist die Zeile für die
  // Tastatur schlicht nicht vorhanden — `focus()` liefe ins Leere.
  it('macht die Zeile zu einem Tabulator-Halt', () => {
    expect(zeile.getAttribute('tabindex')).toBe('0');

    zeile.focus();

    expect(document.activeElement).toBe(zeile);
  });

  // Kriterium: „wird einem Screenreader als bedienbares Element angekündigt".
  // Eine Zeile mit Tabindex, die keine Rolle trägt, ist ein Halt ohne Ansage.
  it('kündigt die Zeile als bedienbares Element an', () => {
    expect(zeile.getAttribute('role')).toBe('button');
  });

  // Kriterium: „Eine fokussierte Zeile ist sichtbar als solche erkennbar."
  // Eine fokussierbare Zeile, der man den Fokus nicht ansieht, ist eine Falle.
  // Der Fokusring ist der app-weite (A11Y-4, `styles.scss`) — die Zeile erbt
  // ihn, sobald sie überhaupt fokussierbar ist.
  it('zeigt den Fokus sichtbar an', () => {
    zeile.focus();

    const stil = getComputedStyle(zeile);
    expect(stil.outlineStyle).toBe('solid');
    expect(parseFloat(stil.outlineWidth)).toBeGreaterThan(0);
  });

  // Kriterium: „öffnet mit Enter … den Detail-Dialog" — und **genau einmal**.
  // Die Tastatur löst dieselbe eine Wirkung aus wie der Zeiger; was das ist,
  // entscheidet die Tabelle, nicht diese Naht.
  it('löst mit Enter genau dieselbe eine Wirkung aus wie ein Klick', () => {
    const event = taste('Enter');

    expect(host.klicks).toBe(1);
    expect(event.defaultPrevented).toBeTrue();
  });

  // Kriterium: „… und mit Leertaste". Die Leertaste muss ihr Vorgabeverhalten
  // verlieren, sonst springt die Seite beim Öffnen eine Bildschirmhöhe weiter.
  it('löst mit der Leertaste genau dieselbe eine Wirkung aus und unterdrückt das Scrollen', () => {
    const event = taste(' ');

    expect(host.klicks).toBe(1);
    expect(event.defaultPrevented).toBeTrue();
  });

  it('reagiert nicht auf eine beliebige andere Taste', () => {
    const event = taste('a');

    expect(host.klicks).toBe(0);
    expect(event.defaultPrevented).toBeFalse();
  });

  // Kriterium: „Der Lösch-Knopf … bleibt eigenständig per Tastatur erreichbar
  // und löst über die Tastatur **keinen** Dialog aus." Ein Tastendruck in einem
  // Knopf der Zeile steigt zur Zeile auf wie jedes andere Ereignis — trüge die
  // Zeile ihn weiter, hieße Löschen mit der Tastatur auch Lesen.
  it('lässt einen Tastendruck in einem Knopf der Zeile unberührt', () => {
    const knopf = fixture.nativeElement.querySelector('[data-testid="knopf"]') as HTMLElement;

    taste('Enter', knopf);
    taste(' ', knopf);

    expect(host.klicks).toBe(0);
  });
});
