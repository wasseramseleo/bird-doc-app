import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { LoginComponent } from './login';

/**
 * Die Musterfläche auf dem Login (#516, ADR 0043) — der eine
 * bildschirmfüllende Moment der App, der sonst leer wirkt.
 *
 * Geprüft wird am echten Bildschirm, nicht an der Quelle: die Spec liest die
 * gerechneten Werte des Pseudo-Elements aus dem Browser. Dass Deckkraft und
 * Kachelgröße wirklich aus den Marken-Tokens kommen und nicht als Zahl im
 * Stylesheet stehen, wird nachgewiesen, indem die Spec die Tokens verstellt
 * und die Fläche mitgehen sieht — eine eingebrannte Zahl bliebe stehen.
 */
describe('Die Musterfläche auf dem Login', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let flaeche: HTMLElement;

  const textur = () => getComputedStyle(flaeche, '::before');

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: { get: () => null } } },
        },
      ],
    });
    fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    flaeche = (fixture.nativeElement as HTMLElement).querySelector('.login-page')!;
  });

  it('trägt die Musterfläche in Tuschefarbe auf Papiergrund', () => {
    // Der gelieferte Kanon ist weiß und transparent; eingefärbt wird er über
    // die Maske, statt eine zweite, eingefärbte Kopie zu führen.
    expect(textur().maskImage).toContain('birddoc-muster.svg');
    // --bd-ink #2B2A26 auf --bd-paper #F7F2E8.
    expect(textur().backgroundColor).toBe('rgb(43, 42, 38)');
    expect(getComputedStyle(flaeche).backgroundColor).toBe('rgb(247, 242, 232)');
  });

  it('bleibt Textur und wird nie zum Motiv', () => {
    // Sie kachelt in ihrer Token-Größe, statt eine einzelne Zeichnung über die
    // Fläche zu ziehen: die Musterfläche zeichnet `fluffy`, nicht die gewählte
    // Marke — groß gesetzt säße dort ein nicht-kanonischer Vogel.
    expect(textur().maskRepeat).toBe('repeat');
    // Die Kachel ist auf die Token-Breite festgelegt, die Höhe folgt dem
    // Seitenverhältnis der Zeichnung (`auto`, vom Browser weggekürzt).
    expect(textur().maskSize).toBe('420px');
  });

  it('holt Deckkraft und Kachelgröße aus den Marken-Tokens', () => {
    flaeche.style.setProperty('--bd-muster-kachel', '123px');
    flaeche.style.setProperty('--bd-muster-deckkraft', '0.42');

    // Eine im Stylesheet eingebrannte Zahl bliebe von der Verstellung
    // unberührt — beide Werte gehen mit, also kommen sie aus den Tokens.
    expect(textur().maskSize).toBe('123px');
    expect(textur().opacity).toBe('0.42');
  });

  it('malt ohne Maskenunterstützung nicht', () => {
    // Schmuck darf nie zum Defekt werden: ohne Maskenunterstützung bliebe von
    // der Regel ein flächiger Tuschekasten über der Anmeldung übrig. Der ganze
    // Regelblock steht deshalb hinter einem @supports-Rahmen auf `mask-image`
    // — fehlt der Rückhalt, entsteht das Pseudo-Element gar nicht erst.
    const regeln = musterRegeln();

    expect(regeln.length).toBeGreaterThan(0);
    for (const { rahmen } of regeln) {
      expect(rahmen.some((bedingung) => bedingung.includes('mask-image'))).toBe(true);
    }
  });

  it('ist schmückend und wird nicht vorgelesen', () => {
    // Sie lebt als Pseudo-Element im Stylesheet, nicht als Element im Baum: es
    // gibt nichts, was ein Bildschirmleser ansagen könnte...
    const baum = fixture.nativeElement as HTMLElement;
    expect(baum.querySelector('[src*="birddoc-muster"]')).toBeNull();
    // ...und das Pseudo-Element trägt keinen Ersatztext (`content: "" / "…"`
    // würde vorgelesen), sondern eine leere Zeichenkette.
    expect(textur().content).toBe('""');
  });
});

/** Jede Regel, die die Musterfläche auf den Login malt, samt ihrer Rahmen. */
function musterRegeln(): { regel: CSSStyleRule; rahmen: string[] }[] {
  const treffer: { regel: CSSStyleRule; rahmen: string[] }[] = [];

  const besuche = (regeln: CSSRuleList, rahmen: string[]) => {
    for (const regel of Array.from(regeln)) {
      if (regel instanceof CSSSupportsRule) {
        besuche(regel.cssRules, [...rahmen, regel.conditionText]);
      } else if (regel instanceof CSSGroupingRule) {
        besuche(regel.cssRules, rahmen);
      } else if (
        regel instanceof CSSStyleRule &&
        regel.selectorText.includes('.login-page') &&
        regel.selectorText.includes('::before')
      ) {
        treffer.push({ regel, rahmen });
      }
    }
  };

  const sheets = [...Array.from(document.styleSheets), ...document.adoptedStyleSheets];
  for (const sheet of sheets) {
    try {
      besuche(sheet.cssRules, []);
    } catch {
      // Ein Stylesheet fremder Herkunft lässt sich nicht lesen — nicht unseres.
    }
  }
  return treffer;
}
