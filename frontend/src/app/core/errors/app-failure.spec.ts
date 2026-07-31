import {HttpErrorResponse, HttpHeaders} from '@angular/common/http';

import {
  classifyFailure,
  failureFromSyncError,
  FEHLERKLASSE_WORTE,
  Fehlerklasse,
  syncErrorEnvelopeOf,
} from './app-failure';

/**
 * Die Einordnung als reine Funktion (ADR 0037), gefüttert mit **echten**
 * DRF-Antwortkörpern — jeder hier eingesetzte Körper ist einer, den
 * `backend/birds/tests/test_error_envelope.py` gegen die laufende API zusichert,
 * oder einer, der ihr abgefragt wurde. Erfundenes, plausibel aussehendes JSON
 * würde genau die Abweichung verdecken, die diese Funktion tragen muss.
 *
 * Vorbild ist `plausibility.spec.ts`: eine getestete Funktion ohne Injektion.
 */

const RING_ALREADY_FIRST_CAUGHT =
  'Für diese Ringnummer besteht in dieser Organisation bereits ein Erstfang.';
const PFLICHTFELD = 'Dieses Feld ist zwingend erforderlich.';
const ADMIN_ONLY =
  'Diese Aktion ist Administrator:innen der Organisation vorbehalten. ' +
  'Bitte wende dich an eine Administratorin oder einen Administrator.';
const SEAT_LIMIT =
  'Das Seat-Limit deiner Organisation ist erreicht. Entferne ein Mitglied oder ' +
  'eine offene Einladung, um eine Person einzuladen.';

/** Was der Browser dem Client reicht: ein `HttpErrorResponse` um den Körper. */
function rejection(status: number, body: unknown, headers?: Record<string, string>): HttpErrorResponse {
  return new HttpErrorResponse({
    status,
    statusText: 'Bad Request',
    url: 'https://app.birddoc.eu/api/birds/data-entries/',
    error: body,
    headers: headers ? new HttpHeaders(headers) : undefined,
  });
}

describe('classifyFailure — Korrigieren (ADR 0037)', () => {
  it('nimmt der doppelt vergebenen Ringnummer ihren deutschen Satz, ihr Feld und ihren Code ab', () => {
    // test_ring_collision_body_is_unchanged_and_carries_its_entry: aus `create`
    // geworfen, also der **blanke** Satz unter dem Feldschlüssel, ohne Liste.
    const failure = classifyFailure(
      rejection(400, {
        ring_number: RING_ALREADY_FIRST_CAUGHT,
        errors: [
          {field: 'ring_number', code: 'invalid', detail: RING_ALREADY_FIRST_CAUGHT},
        ],
      }),
    );

    expect(failure.klasse).toBe(Fehlerklasse.Korrigieren);
    expect(failure.text).toBe(RING_ALREADY_FIRST_CAUGHT);
    expect(failure.field).toBe('ring_number');
    expect(failure.code).toBe('invalid');
    // Die Transportzeichenkette, mit der dieses PRD anfing, kommt nirgends vor.
    expect(failure.text).not.toContain('Http failure response');
  });

  it('behält Status und Ursprungsfehler, statt sie durch die Einordnung zu ersetzen', () => {
    // Nicht optional (ADR 0037): die Offline-Fassade verzweigt auf `status === 0`,
    // der Sync liest `Retry-After` vom Ursprungsfehler.
    const original = rejection(400, {detail: 'abgelehnt'});

    const failure = classifyFailure(original);

    expect(failure.status).toBe(400);
    expect(failure.original).toBe(original);
  });

  it('trägt jeden Satz eines mehrfeldrigen Pflichtfeld-Verstoßes und markiert das erste genannte Feld', () => {
    // test_pflichtfeld_rejection_keeps_its_body_and_gains_required_codes.
    const felder = ['species_id', 'ring_number', 'ring_size'];
    const failure = classifyFailure(
      rejection(400, {
        species_id: [PFLICHTFELD],
        ring_number: [PFLICHTFELD],
        ring_size: [PFLICHTFELD],
        errors: felder.map((field) => ({field, code: 'required', detail: PFLICHTFELD})),
      }),
    );

    expect(failure.klasse).toBe(Fehlerklasse.Korrigieren);
    expect(failure.text).toBe([PFLICHTFELD, PFLICHTFELD, PFLICHTFELD].join(' '));
    expect(failure.field).toBe('species_id');
    expect(failure.code).toBe('required');
  });

  it('gilt für genau 400 und 422 — ADR 0033s Positivliste, unverändert', () => {
    const korrigieren = [400, 401, 403, 404, 409, 418, 422, 429, 500, 502, 503, 0].filter(
      (status) => classifyFailure(rejection(status, {detail: 'x'})).klasse === Fehlerklasse.Korrigieren,
    );

    expect(korrigieren).toEqual([400, 422]);
  });
});

describe('classifyFailure — die übrigen fünf Klassen (ADR 0037)', () => {
  it('ordnet eine tote Sitzung als Neu anmelden ein, obwohl sie als 403 ankommt', () => {
    // Der Körper einer nicht angemeldeten Anfrage gegen `/api/birds/data-entries/`,
    // der laufenden API abgefragt. DRFs SessionAuthentication liefert **keinen**
    // `WWW-Authenticate`-Header, also degradiert DRF den 401 auf einen 403 — nach
    // dem Status allein wäre das „Freigeben lassen", also die Aufforderung, eine
    // Administratorin um etwas zu bitten, das nur eine Anmeldung behebt.
    const failure = classifyFailure(
      rejection(403, {
        detail: 'Anmeldedaten fehlen.',
        errors: [{field: null, code: 'not_authenticated', detail: 'Anmeldedaten fehlen.'}],
      }),
    );

    expect(failure.klasse).toBe(Fehlerklasse.NeuAnmelden);
    expect(failure.text).toBe('Anmeldedaten fehlen.');
    expect(failure.code).toBe('not_authenticated');
  });

  it('ordnet eine Rechteverweigerung als Freigeben lassen ein, ohne Feld', () => {
    // test_admin_only_403_is_unchanged_and_gains_a_field_less_entry.
    const failure = classifyFailure(
      rejection(403, {
        detail: ADMIN_ONLY,
        errors: [{field: null, code: 'permission_denied', detail: ADMIN_ONLY}],
      }),
    );

    expect(failure.klasse).toBe(Fehlerklasse.FreigebenLassen);
    expect(failure.field).toBeNull();
    expect(failure.text).toBe(ADMIN_ONLY);
  });

  it('ordnet eine CSRF-Ablehnung als Erneut versuchen ein, obwohl sie als 403 ankommt', () => {
    // test_csrf_ablehnung_carries_a_different_code_than_rechteverweigerung:
    // derselbe Status wie die Rechteverweigerung, mit dem **gegensätzlichen**
    // Ausweg — nochmal drücken ist die ganze Abhilfe, und es gibt niemanden, der
    // hier etwas freigeben könnte. Genau dafür wurde der 403 disambiguiert
    // (#441): nach dem Status allein schickte er ein Mitglied zu einer Kollegin
    // wegen etwas, das sich von selbst erledigt hätte.
    const failure = classifyFailure(
      rejection(403, {
        detail: 'CSRF Failed: CSRF cookie not set.',
        errors: [
          {field: null, code: 'csrf_failed', detail: 'CSRF Failed: CSRF cookie not set.'},
        ],
      }),
    );

    expect(failure.klasse).toBe(Fehlerklasse.ErneutVersuchen);
    expect(failure.remedy).toBe('erneut-versuchen');
    expect(failure.code).toBe('csrf_failed');
  });

  it('ordnet einen 404 als App aktualisieren ein', () => {
    // test_not_found_detail_is_unchanged_and_gains_a_field_less_entry.
    const failure = classifyFailure(
      rejection(404, {
        detail: 'No DataEntry matches the given query.',
        errors: [
          {field: null, code: 'not_found', detail: 'No DataEntry matches the given query.'},
        ],
      }),
    );

    expect(failure.klasse).toBe(Fehlerklasse.AppAktualisieren);
    expect(failure.code).toBe('not_found');
  });

  it('ordnet einen Verbindungsabbruch als Erneut versuchen ein und sagt es auf Deutsch', () => {
    // Ein echter Verbindungsabbruch: Status 0, im Körper ein ProgressEvent.
    const failure = classifyFailure(rejection(0, new ProgressEvent('error')));

    expect(failure.klasse).toBe(Fehlerklasse.ErneutVersuchen);
    expect(failure.status).toBe(0);
    expect(failure.text).toBeTruthy();
    expect(failure.text).not.toContain('Http failure response');
    expect(failure.text).not.toContain('0');
  });

  it('ordnet einen 5xx und einen 429 als Erneut versuchen ein', () => {
    expect(classifyFailure(rejection(500, '')).klasse).toBe(Fehlerklasse.ErneutVersuchen);
    expect(classifyFailure(rejection(503, '')).klasse).toBe(Fehlerklasse.ErneutVersuchen);
    expect(classifyFailure(rejection(429, {detail: 'zu viele Anfragen'})).klasse).toBe(
      Fehlerklasse.ErneutVersuchen,
    );
  });

  it('lässt einen Fehler ohne Transport-Evidenz auf Unbekannt fallen, ohne die Eingabe zu beschuldigen', () => {
    const failure = classifyFailure(new Error('IndexedDB read failed'));

    expect(failure.klasse).toBe(Fehlerklasse.Unbekannt);
    expect(failure.status).toBeNull();
    expect(failure.text).toBeTruthy();
    expect(failure.text).not.toContain('IndexedDB');
  });
});

describe('classifyFailure — was passiert, wenn der Client den Fall nicht kennt', () => {
  it('degradiert einen unbekannten Code auf seinen Satz, behält ihn aber', () => {
    // test_seat_limit_409_is_unchanged_and_carries_its_own_code: ein Code, den
    // dieser Client nicht kennt, auf einem Status, der in keiner Evidenzliste
    // steht. Er bekommt keine eigene Abhilfe — aber den Satz, nie einen
    // Rohstatus und nie nichts.
    const failure = classifyFailure(
      rejection(409, {
        detail: SEAT_LIMIT,
        errors: [{field: null, code: 'seat_limit_reached', detail: SEAT_LIMIT}],
      }),
    );

    expect(failure.klasse).toBe(Fehlerklasse.Unbekannt);
    expect(failure.text).toBe(SEAT_LIMIT);
    expect(failure.code).toBe('seat_limit_reached');
    expect(failure.context).toBeNull();
  });

  it('holt aus einem Körper ganz ohne `errors` weiterhin eine brauchbare Meldung', () => {
    // Die abgelehnte Anmeldung, der laufenden API abgefragt: `auth_views` baut
    // den `Response` von Hand, durchläuft also keinen Exception-Handler und
    // trägt bis heute keinen Umschlag. Das alte Format muss weiter tragen — und
    // ist auch der Grund, warum diese Einordnung nicht auf #440/#441 wartet.
    const failure = classifyFailure(
      rejection(401, {
        detail: 'Anmeldung fehlgeschlagen. Bitte überprüfe Benutzernamen und Passwort.',
      }),
    );

    expect(failure.klasse).toBe(Fehlerklasse.NeuAnmelden);
    expect(failure.text).toBe(
      'Anmeldung fehlgeschlagen. Bitte überprüfe Benutzernamen und Passwort.',
    );
    expect(failure.code).toBeNull();
  });

  it('liest auch die umschlaglosen Feldfehler und die blanke Liste', () => {
    // Zwei weitere Formen ohne Umschlag: die feldgeschlüsselte Form eines alten
    // Servers, und die JSON-*Liste*, als die DRF ein `raise ValidationError("…")`
    // außerhalb von `is_valid` rendert (test_body_that_is_not_a_mapping…).
    expect(classifyFailure(rejection(400, {ring_number: ['Nur Ziffern erlaubt.']})).text).toBe(
      'Nur Ziffern erlaubt.',
    );
    expect(
      classifyFailure(rejection(400, ['Die Organisation braucht mindestens eine:n Administrator:in.']))
        .text,
    ).toBe('Die Organisation braucht mindestens eine:n Administrator:in.');
  });

  it('sagt selbst dann etwas Brauchbares, wenn der Körper gar nichts hergibt', () => {
    // Eine HTML-Fehlerseite des Reverse-Proxy, ein leerer Körper: die Meldung
    // fällt auf den Ersatzsatz der Klasse zurück — nie leer, nie der Status,
    // nie die Transportzeichenkette.
    const failure = classifyFailure(rejection(502, null));

    expect(failure.text).toBe(FEHLERKLASSE_WORTE[Fehlerklasse.ErneutVersuchen].ersatzGrund);
    expect(failure.text).not.toContain('502');
  });
});

describe('AppFailure — der eine Ausweg je Klasse (ADR 0037)', () => {
  it('trägt die Abhilfe seiner Klasse mit sich', () => {
    expect(classifyFailure(rejection(400, {detail: 'x'})).remedy).toBe('korrigieren');
    expect(classifyFailure(rejection(401, {detail: 'x'})).remedy).toBe('neu-anmelden');
    expect(classifyFailure(rejection(403, {detail: 'x'})).remedy).toBe('freigeben-lassen');
    expect(classifyFailure(rejection(404, {detail: 'x'})).remedy).toBe('app-aktualisieren');
    expect(classifyFailure(rejection(503, {detail: 'x'})).remedy).toBe('erneut-versuchen');
    expect(classifyFailure(rejection(409, {detail: 'x'})).remedy).toBe('fehler-melden');
  });
});

describe('failureFromSyncError — ein gemerkter Synchronisierungsfehler', () => {
  it('hebt die gespeicherte Zeichenkette in dieselbe Struktur, ohne einen Code zu erfinden', () => {
    // Ein geflaggter Outbox-Eintrag hält heute eine blanke Zeile Prosa (#164).
    // Damit das Banner online wie beim Replay dasselbe Bauteil ist, wird sie in
    // dieselbe Struktur gehoben: Klasse *Korrigieren*, weil nur ein 400/422 ein
    // Flag verdient (ADR 0033s Positivliste) — aber ohne Code, denn keiner war
    // dabei. (#445 schreibt später die volle Struktur, statt sie zu heben.)
    const failure = failureFromSyncError(RING_ALREADY_FIRST_CAUGHT);

    expect(failure.klasse).toBe(Fehlerklasse.Korrigieren);
    expect(failure.text).toBe(RING_ALREADY_FIRST_CAUGHT);
    expect(failure.code).toBeNull();
    expect(failure.field).toBeNull();
    expect(failure.status).toBeNull();
  });
});

describe('Der gemerkte Synchronisierungsfehler trägt die volle Struktur (#445, ADR 0038)', () => {
  /**
   * Der kollidierende Erstfang, wie ihn `ring_already_first_caught` mitbringt —
   * `backend/birds/tests/test_error_context.py::test_the_collision_names_the_
   * erstfang_that_holds_the_number`, Feld für Feld.
   */
  const RIVAL = {
    rival: {
      id: '6f1a6a1e-0f0e-4f5a-9a3b-2f9d1c7e5b40',
      date_time: '2026-03-01T12:00:00Z',
      species: 'Teichrohrsänger',
      staff: 'FRE',
    },
  };

  /** Die Zurückweisung, mit der PRD #438 anfing — mit ihrem Kontext. */
  function ringKollision(): HttpErrorResponse {
    return rejection(400, {
      ring_number: RING_ALREADY_FIRST_CAUGHT,
      errors: [
        {
          field: 'ring_number',
          code: 'ring_already_first_caught',
          detail: RING_ALREADY_FIRST_CAUGHT,
          context: RIVAL,
        },
      ],
    });
  }

  it('nimmt der Zurückweisung Klasse, Code, Text, Feld und Kontext für den Eintrag ab', () => {
    const umschlag = syncErrorEnvelopeOf(classifyFailure(ringKollision()));

    expect(umschlag).toEqual({
      klasse: Fehlerklasse.Korrigieren,
      code: 'ring_already_first_caught',
      field: 'ring_number',
      detail: RING_ALREADY_FIRST_CAUGHT,
      context: RIVAL,
    });
  });

  it('lässt sich durch IndexedDB tragen — nichts daran ist unklonbar', () => {
    // Was auf den Eintrag geschrieben wird, geht durch den strukturierten Klon
    // der IndexedDB. Der Ursprungsfehler (ein `HttpErrorResponse`) ist genau
    // deshalb *nicht* dabei: er würde den Schreibvorgang werfen lassen.
    const umschlag = syncErrorEnvelopeOf(classifyFailure(ringKollision()));

    expect(structuredClone(umschlag)).toEqual(umschlag);
  });

  it('gibt Tage später, ohne Netz, denselben Fehlschlag zurück, den die Leitung trug', () => {
    // User Story 31: derselbe vollständige Fehlschlag — samt kollidierendem
    // Erstfang —, obwohl nichts davon noch einmal erfragt werden könnte.
    const online = classifyFailure(ringKollision());

    const wiederGeoeffnet = failureFromSyncError(online.text, syncErrorEnvelopeOf(online));

    expect(wiederGeoeffnet.klasse).toBe(online.klasse);
    expect(wiederGeoeffnet.code).toBe(online.code);
    expect(wiederGeoeffnet.field).toBe(online.field);
    expect(wiederGeoeffnet.text).toBe(online.text);
    expect(wiederGeoeffnet.context).toEqual(online.context);
    expect(wiederGeoeffnet.remedy).toBe(online.remedy);
    // Kein Transport dahinter: der Fehlschlag ist erinnert, nicht soeben passiert.
    expect(wiederGeoeffnet.status).toBeNull();
  });

  it('erfindet für die blanke Zeichenkette eines älteren Bundles keinen Code', () => {
    // Ein Gerät, das wochenlang ohne Netz war, hält genau solche Einträge — und
    // sie sind der Grund, warum es diesen Mechanismus gibt. Ohne Umschlag ist
    // die Zeile ein reines `detail`: Klasse *Korrigieren* (nur ein 400/422
    // verdient ein Flag, ADR 0033), sonst nichts.
    const failure = failureFromSyncError(RING_ALREADY_FIRST_CAUGHT, undefined);

    expect(failure.klasse).toBe(Fehlerklasse.Korrigieren);
    expect(failure.text).toBe(RING_ALREADY_FIRST_CAUGHT);
    expect(failure.code).toBeNull();
    expect(failure.field).toBeNull();
    expect(failure.context).toBeNull();
  });

  it('fällt auf Korrigieren zurück, wenn ein späteres Bundle eine unbekannte Klasse hinterließ', () => {
    // Dieselbe Haltung wie ADR 0031 gegenüber einem zurückgezogenen Vokabular:
    // was in IndexedDB liegt, überlebt jedes Bundle — auch das, das es schrieb.
    // Eine Klasse, die dieser Client nicht kennt, darf das Banner nicht ohne
    // Worte dastehen lassen.
    const failure = failureFromSyncError(RING_ALREADY_FIRST_CAUGHT, {
      klasse: 'aus-der-zukunft' as never,
      code: 'ring_already_first_caught',
      field: 'ring_number',
      detail: RING_ALREADY_FIRST_CAUGHT,
      context: null,
    });

    expect(failure.klasse).toBe(Fehlerklasse.Korrigieren);
    expect(failure.text).toBe(RING_ALREADY_FIRST_CAUGHT);
    expect(failure.code).toBe('ring_already_first_caught');
  });
});
