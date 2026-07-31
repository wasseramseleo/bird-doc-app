import {Component} from '@angular/core';
import {ComponentFixture, TestBed} from '@angular/core/testing';
import {HttpErrorResponse} from '@angular/common/http';
import {MatButtonModule} from '@angular/material/button';
import {provideNoopAnimations} from '@angular/platform-browser/animations';

import {LoadFailureComponent} from './load-failure';
import {AppIconEmptyDirective, AppIconErrorDirective} from '../app-icons';
import {renderedGlyph, seamGlyph} from '../app-icons.testing';
import {AppFailure, classifyFailure} from '../../core/errors/app-failure';

/** Ein gescheitertes GET, wie es aus der Leitung kommt. */
function ladefehler(status: number, body: unknown = null): AppFailure {
  return classifyFailure(
    new HttpErrorResponse({
      status,
      statusText: 'error',
      url: 'https://app.birddoc.eu/api/birds/ringing-stations/',
      error: body,
    }),
  );
}

/**
 * Ein Bildschirm, der neben „Erneut laden" schon eine eigene Ausstiegs-Aktion
 * hat — das `„Zur Liste"` des Erfassungsformulars (#385). Sie wird
 * hineingereicht und muss daneben stehen bleiben.
 */
@Component({
  imports: [LoadFailureComponent, MatButtonModule],
  template: `
    <app-load-failure [failure]="failure" titel="Der Eintrag konnte nicht geladen werden.">
      <button mat-stroked-button type="button" data-testid="load-error-back">Zur Liste</button>
    </app-load-failure>
  `,
})
class HostMitAusstieg {
  readonly failure = ladefehler(500, {detail: 'Serverfehler.'});
}

describe('LoadFailureComponent', () => {
  let fixture: ComponentFixture<LoadFailureComponent>;

  function render(failure: AppFailure, titel?: string): HTMLElement {
    fixture = TestBed.createComponent(LoadFailureComponent);
    fixture.componentRef.setInput('failure', failure);
    if (titel !== undefined) {
      fixture.componentRef.setInput('titel', titel);
    }
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const knopf = (el: HTMLElement, label: string): HTMLButtonElement | undefined =>
    Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(label));

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoadFailureComponent, HostMitAusstieg],
      providers: [provideNoopAnimations()],
    }).compileComponents();
  });

  it('nennt, was nicht geladen werden konnte, den Grund des Servers und den Ausweg', () => {
    const el = render(
      ladefehler(500, {detail: 'Die Datenbank antwortet gerade nicht.'}),
      'Stationen konnten nicht geladen werden.',
    );

    const zustand = el.querySelector('[data-testid="load-error"]')!;
    expect(zustand.getAttribute('role')).toBe('alert');
    expect(zustand.textContent).toContain('Stationen konnten nicht geladen werden.');
    expect(zustand.textContent).toContain('Die Datenbank antwortet gerade nicht.');
    expect(zustand.textContent).toContain('Bitte versuche es noch einmal.');
    // Die Transportzeichenkette, mit der PRD #438 anfing, steht nirgends.
    expect(zustand.textContent).not.toContain('Http failure response');
  });

  it('zeichnet das App-Icon des kaputten Zustands, nicht das des leeren', () => {
    const el = render(ladefehler(0));

    // #439: am gezeichneten Ergebnis geprüft, nicht am Marker im Template — ein
    // vergessener `imports`-Eintrag bliebe sonst unsichtbar.
    expect(renderedGlyph(el.querySelector('mat-icon'))).toBeTruthy();
    expect(seamGlyph(fixture, AppIconErrorDirective)).toBeTruthy();
    expect(seamGlyph(fixture, AppIconEmptyDirective)).toBe('');
  });

  it('bietet bei „Erneut versuchen" das erneute Laden an und meldet es nach oben', () => {
    const el = render(ladefehler(0));
    let versuche = 0;
    fixture.componentInstance.reload.subscribe(() => (versuche += 1));

    const erneut = knopf(el, 'Erneut laden');
    expect(erneut).toBeDefined();
    erneut!.click();

    expect(versuche).toBe(1);
  });

  // ADR 0037, Zeile „Laden im Hintergrund": nur *Erneut versuchen* trägt hier
  // „+ Erneut laden". Die übrigen Klassen sagen an Ort und Stelle, was sie
  // brauchen — ein erneutes Laden hilft gegen eine abgelaufene Sitzung, eine
  // fehlende Freigabe oder ein veraltetes Bundle nicht.
  it('sagt bei „Neu anmelden", was gebraucht wird, statt erneut laden zu lassen', () => {
    const el = render(
      ladefehler(403, {
        detail: 'Anmeldedaten fehlen.',
        errors: [{field: null, code: 'not_authenticated', detail: 'Anmeldedaten fehlen.'}],
      }),
    );

    expect(el.textContent).toContain('Bitte melde dich erneut an.');
    expect(knopf(el, 'Erneut laden')).toBeUndefined();
  });

  it('sagt bei „Freigeben lassen", wer das darf, statt erneut laden zu lassen', () => {
    const el = render(
      ladefehler(403, {
        detail: 'Diese Aktion ist Administrator:innen der Organisation vorbehalten.',
        errors: [
          {
            field: null,
            code: 'permission_denied',
            detail: 'Diese Aktion ist Administrator:innen der Organisation vorbehalten.',
          },
        ],
      }),
    );

    expect(el.textContent).toContain('Administrator');
    expect(knopf(el, 'Erneut laden')).toBeUndefined();
  });

  it('sagt bei „App aktualisieren", dass die App zu aktualisieren ist', () => {
    const el = render(ladefehler(404, {detail: 'Nicht gefunden.'}));

    expect(el.textContent).toContain('Bitte aktualisiere die App.');
    expect(knopf(el, 'Erneut laden')).toBeUndefined();
  });

  it('nimmt die Ausstiegs-Aktion des Bildschirms auf und stellt sie daneben', () => {
    const host = TestBed.createComponent(HostMitAusstieg);
    host.detectChanges();
    const el = host.nativeElement as HTMLElement;

    const zustand = el.querySelector('[data-testid="load-error"]')!;
    expect(zustand.querySelector('[data-testid="load-error-back"]')).toBeTruthy();
    // …und „Erneut laden" steht weiter daneben: der Ausstieg ersetzt es nicht.
    expect(knopf(el, 'Erneut laden')).toBeDefined();
  });

  // ADR 0037, Moment-Achse: ein Laden bekommt **kein** Banner. Das Banner sitzt
  // über einem bedienbaren Formular; dieser Zustand ersetzt den Inhalt, der
  // nicht kam.
  it('rendert kein Banner — ein Laden bekommt keines', () => {
    const el = render(ladefehler(500));

    expect(el.querySelector('[data-testid="failure-banner"]')).toBeNull();
  });

  it('bleibt ohne Satz des Servers verständlich', () => {
    const el = render(ladefehler(500), 'Projekte konnten nicht geladen werden.');

    expect(el.textContent).toContain('Projekte konnten nicht geladen werden.');
    expect(el.textContent).toContain('Der Server war gerade nicht erreichbar.');
  });
});
