import {HttpErrorResponse} from '@angular/common/http';

import {AppFailure, classifyFailure, failureFromSyncError} from './app-failure';
import {kollidierenderErstfang} from './ring-kollision';

/**
 * Der kollidierende Erstfang, aus dem Fehlschlag gelesen (#444, ADR 0038).
 *
 * Wie die Einordnung selbst eine **reine Funktion**, gefüttert mit echten
 * DRF-Antwortkörpern — den Körpern aus
 * `backend/birds/tests/test_error_context.py`, Feld für Feld.
 */

const KOLLISION = 'Für diese Ringnummer besteht in dieser Organisation bereits ein Erstfang.';

/** Der Rivale, wie ihn `test_the_collision_names_the_erstfang_that_holds_the_number` zusichert. */
const RIVAL = {
  id: '6f1a6a1e-0f0e-4f5a-9a3b-2f9d1c7e5b40',
  date_time: '2026-07-28T08:15:00+02:00',
  species: 'Teichrohrsänger',
  staff: 'FRE',
};

/** Der Antwortkörper der Zurückweisung — die DRF-Form plus der Umschlag. */
function kollisionsKoerper(context: unknown = {rival: RIVAL}): Record<string, unknown> {
  return {
    ring_number: KOLLISION,
    errors: [{field: 'ring_number', code: 'ring_already_first_caught', detail: KOLLISION, context}],
  };
}

/** Derselbe Körper, wie ihn ein Backend vor #442 schickte: ohne `context`. */
function kollisionsKoerperOhneKontext(): Record<string, unknown> {
  return {
    ring_number: KOLLISION,
    errors: [{field: 'ring_number', code: 'ring_already_first_caught', detail: KOLLISION}],
  };
}

function zurueckweisung(body: unknown): AppFailure {
  return classifyFailure(
    new HttpErrorResponse({
      status: 400,
      statusText: 'Bad Request',
      url: 'https://app.birddoc.eu/api/birds/data-entries/',
      error: body,
    }),
  );
}

describe('kollidierenderErstfang (#444)', () => {
  it('liest Id, Zeitpunkt, Art und Beringer-Kürzel aus dem Kontext', () => {
    expect(kollidierenderErstfang(zurueckweisung(kollisionsKoerper()))).toEqual({
      id: RIVAL.id,
      date_time: RIVAL.date_time,
      species: RIVAL.species,
      staff: RIVAL.staff,
    });
  });

  it('liest ihn genauso aus einem gemerkten Synchronisierungsfehler', () => {
    // #445: Tage später, ohne Netz — derselbe Umschlag, aus IndexedDB statt von
    // der Leitung. Die Abhilfen hängen am Fehlschlag, nicht am Transport.
    const gemerkt = failureFromSyncError(KOLLISION, {
      klasse: 'korrigieren',
      code: 'ring_already_first_caught',
      field: 'ring_number',
      detail: KOLLISION,
      context: {rival: RIVAL},
    });

    expect(kollidierenderErstfang(gemerkt)?.id).toBe(RIVAL.id);
  });

  it('nennt keinen Rivalen, wo der Kontext fehlt', () => {
    // Ein älteres Backend, ein Bundle mitten in der Auslieferung: der Code ist
    // da, der Kontext nicht. Dann bleibt es beim Satz allein (ADR 0038).
    expect(kollidierenderErstfang(zurueckweisung(kollisionsKoerperOhneKontext()))).toBeNull();
    expect(kollidierenderErstfang(zurueckweisung(kollisionsKoerper(null)))).toBeNull();
    expect(kollidierenderErstfang(zurueckweisung(kollisionsKoerper({})))).toBeNull();
  });

  it('nennt keinen Rivalen ohne Id — was sich nicht öffnen lässt, wird nicht angeboten', () => {
    const ohneId = {rival: {date_time: RIVAL.date_time, species: RIVAL.species, staff: 'FRE'}};

    expect(kollidierenderErstfang(zurueckweisung(kollisionsKoerper(ohneId)))).toBeNull();
  });

  it('erfindet nichts, wo eine Angabe fehlt', () => {
    // Ein gelöschter Beringer, eine Art ohne deutschen Namen: der Server lässt
    // das Feld weg, statt es zu erfinden — und dieser Client tut es ihm nach.
    const kargerRivale = {rival: {id: RIVAL.id}};

    expect(kollidierenderErstfang(zurueckweisung(kollisionsKoerper(kargerRivale)))).toEqual({
      id: RIVAL.id,
      date_time: null,
      species: null,
      staff: null,
    });
  });

  it('nennt keinen Rivalen bei einem anderen Code', () => {
    // Der Code ist die Naht (ADR 0038), nicht der Text: eine andere
    // Zurückweisung mit einem mitgereisten Kontext bekommt diese Abhilfen nicht.
    const andereZurueckweisung = zurueckweisung({
      ring_number: 'Ungültige Ringnummer.',
      errors: [
        {
          field: 'ring_number',
          code: 'invalid',
          detail: 'Ungültige Ringnummer.',
          context: {rival: RIVAL},
        },
      ],
    });

    expect(kollidierenderErstfang(andereZurueckweisung)).toBeNull();
  });

  it('nennt keinen Rivalen, wo gar kein Code mitkam', () => {
    // Die alte Form ganz ohne Umschlag — ein Bundle von letztem Monat sieht
    // genau das (ADR 0033).
    expect(kollidierenderErstfang(zurueckweisung({ring_number: [KOLLISION]}))).toBeNull();
    expect(kollidierenderErstfang(failureFromSyncError(KOLLISION))).toBeNull();
  });
});
