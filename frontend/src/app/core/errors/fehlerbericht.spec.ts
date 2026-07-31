import {HttpErrorResponse} from '@angular/common/http';

import {classifyFailure, failureFromSyncError, Fehlerklasse} from './app-failure';
import {
  FehlerberichtUmstaende,
  fehlerMeldenAngeboten,
  fehlerberichtVorlage,
} from './fehlerbericht';

/**
 * „Fehler melden" (#449, ADR 0037) als reine Funktion — Vorbild ist
 * `app-failure.spec.ts`: echte DRF-Antwortkörper, keine Injektion.
 */

function rejection(status: number, body: unknown, url?: string): HttpErrorResponse {
  return new HttpErrorResponse({
    status,
    statusText: 'error',
    url: url ?? 'https://app.birddoc.eu/api/birds/data-entries/',
    error: body,
  });
}

describe('fehlerMeldenAngeboten (#449, ADR 0037)', () => {
  it('bietet es bei *Unbekannt* an — dort gibt es nichts, was das Mitglied selbst tun kann', () => {
    const failure = classifyFailure(rejection(418, {detail: 'Ich bin eine Teekanne.'}));

    expect(failure.klasse).toBe(Fehlerklasse.Unbekannt);
    expect(fehlerMeldenAngeboten(failure)).toBeTrue();
  });

  it('bietet es bei einem Fehlschlag ganz ohne Transport an — auch der ist unbekannt', () => {
    const failure = classifyFailure(new TypeError('kaputt'));

    expect(fehlerMeldenAngeboten(failure)).toBeTrue();
  });

  it('bietet es bei einem 5xx an — der Server hat sich verschluckt, nicht die Eingabe', () => {
    for (const status of [500, 502, 503]) {
      expect(fehlerMeldenAngeboten(classifyFailure(rejection(status, {detail: 'Wartung'}))))
        .withContext(`${status}`)
        .toBeTrue();
    }
  });

  it('bietet es beim *Korrigieren* nicht an — das Formular ist der Ausweg', () => {
    const failure = classifyFailure(
      rejection(400, {
        ring_number: 'Für diese Ringnummer besteht in dieser Organisation bereits ein Erstfang.',
        errors: [
          {
            field: 'ring_number',
            code: 'ring_already_first_caught',
            detail:
              'Für diese Ringnummer besteht in dieser Organisation bereits ein Erstfang.',
          },
        ],
      }),
    );

    expect(failure.klasse).toBe(Fehlerklasse.Korrigieren);
    expect(fehlerMeldenAngeboten(failure)).toBeFalse();
  });

  it('bietet es bei einem gespeicherten Synchronisierungsfehler nicht an', () => {
    expect(fehlerMeldenAngeboten(failureFromSyncError('Die Station ist archiviert.'))).toBeFalse();
  });

  it('bietet es beim *Erneut versuchen* ohne 5xx nicht an — noch einmal drücken genügt', () => {
    // Der Verbindungsabbruch (`status === 0`) und die Drosselung: dieselbe
    // Klasse wie ein 5xx, aber kein Fehler, über den zu berichten wäre. Die
    // Klasse allein entscheidet also nicht — die Evidenz tut es mit.
    const abbruch = classifyFailure(rejection(0, null));
    const gedrosselt = classifyFailure(rejection(429, {detail: 'Zu viele Anfragen.'}));

    expect(abbruch.klasse).toBe(Fehlerklasse.ErneutVersuchen);
    expect(gedrosselt.klasse).toBe(Fehlerklasse.ErneutVersuchen);
    expect(fehlerMeldenAngeboten(abbruch)).toBeFalse();
    expect(fehlerMeldenAngeboten(gedrosselt)).toBeFalse();
  });

  it('bietet es beim *Neu anmelden* nicht an', () => {
    const failure = classifyFailure(
      rejection(401, {
        detail: 'Anmeldedaten fehlen.',
        errors: [{field: null, code: 'not_authenticated', detail: 'Anmeldedaten fehlen.'}],
      }),
    );

    expect(failure.klasse).toBe(Fehlerklasse.NeuAnmelden);
    expect(fehlerMeldenAngeboten(failure)).toBeFalse();
  });

  it('bietet es beim *Freigeben lassen* nicht an', () => {
    const failure = classifyFailure(
      rejection(403, {
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

    expect(failure.klasse).toBe(Fehlerklasse.FreigebenLassen);
    expect(fehlerMeldenAngeboten(failure)).toBeFalse();
  });

  it('bietet es beim *App aktualisieren* nicht an', () => {
    const failure = classifyFailure(rejection(404, {detail: 'Nicht gefunden.'}));

    expect(failure.klasse).toBe(Fehlerklasse.AppAktualisieren);
    expect(fehlerMeldenAngeboten(failure)).toBeFalse();
  });
});

describe('fehlerberichtVorlage (#449, User Story 22/23)', () => {
  const ZEITPUNKT = new Date(Date.UTC(2026, 6, 31, 5, 12, 43));

  const umstaende = (overrides: Partial<FehlerberichtUmstaende> = {}): FehlerberichtUmstaende => ({
    bildschirm: '/data-entry',
    zeitpunkt: ZEITPUNKT,
    versionVeraltet: false,
    ...overrides,
  });

  const serverfehler = () =>
    classifyFailure(
      rejection(500, {
        detail: 'Ein Serverfehler ist aufgetreten.',
        errors: [
          {field: null, code: 'server_error', detail: 'Ein Serverfehler ist aufgetreten.'},
        ],
      }),
    );

  it('trägt Endpunkt, Status, Code, Zeitpunkt, Bildschirm und Version', () => {
    const vorlage = fehlerberichtVorlage(serverfehler(), umstaende());

    expect(vorlage).toContain('Endpunkt: https://app.birddoc.eu/api/birds/data-entries/');
    expect(vorlage).toContain('Status: 500');
    expect(vorlage).toContain('Code: server_error');
    expect(vorlage).toContain('Zeitpunkt: 2026-07-31T05:12:43.000Z');
    expect(vorlage).toContain('Bildschirm: /data-entry');
    expect(vorlage).toContain('Version: aktuell');
  });

  it('nennt eine veraltete Version als solche — die eine Version, die das Gerät von sich weiß', () => {
    expect(fehlerberichtVorlage(serverfehler(), umstaende({versionVeraltet: true}))).toContain(
      'Version: veraltet',
    );
  });

  it('lässt den Cursor über den Angaben — die eigenen Worte zuerst', () => {
    const vorlage = fehlerberichtVorlage(serverfehler(), umstaende());

    // Die Vorlage beginnt mit leerem Raum: was das Mitglied schreibt, steht
    // oben, der technische Block reist darunter mit.
    expect(vorlage.startsWith('\n')).toBeTrue();
  });

  it('lässt einen fehlenden Code weg, statt „undefined" zu schreiben', () => {
    // Ein von Hand gebauter `Response` durchläuft keinen Exception-Handler und
    // trägt deshalb bis heute keinen Umschlag — also keinen Code.
    const ohneCode = classifyFailure(rejection(502, 'Bad Gateway'));

    const vorlage = fehlerberichtVorlage(ohneCode, umstaende());

    expect(vorlage).not.toContain('Code:');
    expect(vorlage).not.toContain('undefined');
    expect(vorlage).not.toContain('null');
    expect(vorlage).toContain('Status: 502');
  });

  it('lässt einen fehlenden Bildschirm weg, statt „null" zu schreiben', () => {
    const vorlage = fehlerberichtVorlage(serverfehler(), umstaende({bildschirm: null}));

    expect(vorlage).not.toContain('Bildschirm:');
    expect(vorlage).not.toContain('null');
    expect(vorlage).not.toContain('undefined');
  });

  it('lässt Endpunkt und Status weg, wo gar kein Transport dahinterstand', () => {
    const vorlage = fehlerberichtVorlage(classifyFailure(new TypeError('kaputt')), umstaende());

    expect(vorlage).not.toContain('Endpunkt:');
    expect(vorlage).not.toContain('Status:');
    expect(vorlage).not.toContain('undefined');
    expect(vorlage).not.toContain('null');
    // Was das Gerät selbst weiß, steht trotzdem da.
    expect(vorlage).toContain('Zeitpunkt: 2026-07-31T05:12:43.000Z');
    expect(vorlage).toContain('Bildschirm: /data-entry');
    expect(vorlage).toContain('Version: aktuell');
  });

  it('schreibt nie die Transportzeichenkette, mit der dieses PRD anfing', () => {
    expect(fehlerberichtVorlage(serverfehler(), umstaende())).not.toContain(
      'Http failure response',
    );
  });
});
