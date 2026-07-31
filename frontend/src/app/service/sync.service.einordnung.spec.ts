import {TestBed} from '@angular/core/testing';
import {provideHttpClient} from '@angular/common/http';
import {HttpTestingController, provideHttpClientTesting} from '@angular/common/http/testing';
import {provideRouter} from '@angular/router';
import {firstValueFrom} from 'rxjs';

import {SyncService} from './sync.service';
import {AuthService} from './auth.service';
import {OutboxStoreService} from '../core/offline/outbox-store';
import {IndexedDbStore} from '../core/offline/indexed-db-store';
import {Fehlerklasse} from '../core/errors/app-failure';
import {OutboxEntry} from '../models/outbox-entry.model';
import {AuthUser} from '../models/auth-user.model';

/**
 * Der Synchronisierungsfehler trägt die volle Struktur (#445, ADR 0038) —
 * geprüft an derselben Naht wie der übrige Replay: was auf der Leitung steht,
 * und was danach im Datensatz steht.
 *
 * **Warum eine eigene Datei.** `sync.service.spec.ts` bleibt Zeichen für Zeichen
 * unangetastet: seine Zusicherungen sind der Beweis, dass ADR 0033s
 * Positivliste die Kollabierung von `isValidationRejection` in die gemeinsame
 * Einordnung überlebt hat — und dass die deutsche Zeile auf dem geflaggten
 * Eintrag dieselbe blieb, während der Umschlag additiv danebentrat. Ein Beweis,
 * an dem man unterwegs herumbessert, ist keiner. Das Neue steht deshalb hier.
 *
 * IndexedDB ist die echte Browser-Implementierung, wie in jeder Offline-Spec
 * dieses Repos; `settle()` steht zwischen einem Schritt, der sie anfasst, und
 * der nächsten Zusicherung — und wartet auf die Ruhe des Stores selbst statt
 * auf eine feste Frist (#464).
 */

function settle(): Promise<void> {
  return TestBed.inject(IndexedDbStore).whenIdle();
}

function makeEntry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    id: 'uuid-1',
    accountKey: 'fre',
    payload: {idempotency_key: 'uuid-1', species_id: 's1', ring_number: '0043'},
    queuedAt: '2026-07-02T09:00:00.000Z',
    ...overrides,
  };
}

function authUser(): AuthUser {
  return {
    username: 'fre',
    handle: 'FRE',
    isStaff: false,
    rolle: 'mitglied',
    organization: null,
  };
}

function meResponse() {
  return {
    username: 'fre',
    handle: 'FRE',
    is_staff: false,
    active_organization_rolle: 'mitglied',
    active_organization: null,
  };
}

const RING_ALREADY_FIRST_CAUGHT =
  'Für diese Ringnummer besteht in dieser Organisation bereits ein Erstfang.';

/**
 * Der kollidierende Erstfang, wie ihn der Server mitschickt —
 * `backend/birds/tests/test_error_context.py`, Feld für Feld.
 */
const RIVAL = {
  rival: {
    id: '6f1a6a1e-0f0e-4f5a-9a3b-2f9d1c7e5b40',
    date_time: '2026-03-01T12:00:00Z',
    species: 'Teichrohrsänger',
    staff: 'FRE',
  },
};

describe('SyncService — der Synchronisierungsfehler trägt die volle Struktur (#445)', () => {
  let service: SyncService;
  let httpMock: HttpTestingController;
  let outboxStore: OutboxStoreService;
  let auth: AuthService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    service = TestBed.inject(SyncService);
    httpMock = TestBed.inject(HttpTestingController);
    outboxStore = TestBed.inject(OutboxStoreService);
    auth = TestBed.inject(AuthService);
  });

  afterEach(async () => {
    httpMock.verify();
    const db = TestBed.inject(IndexedDbStore);
    await db.delete('outbox', 'uuid-1');
    await db.delete('outbox', 'uuid-2');
  });

  function expectCsrfFetch() {
    return httpMock.expectOne((r) => r.method === 'GET' && r.url.endsWith('/auth/me/'));
  }

  function expectCreatePost() {
    return httpMock.expectOne((r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'));
  }

  it('schreibt den ganzen Umschlag auf den zurückgewiesenen Eintrag — der kollidierende Erstfang inbegriffen', async () => {
    // User Story 31: der Eintrag muss Tage später ohne Netz dasselbe
    // vollständige Banner zeigen können. Was jetzt nicht mit auf den Datensatz
    // kommt, ist dann für immer weg — nachfassen kann er nicht.
    auth.currentUser.set(authUser());
    await outboxStore.add(
      makeEntry({id: 'uuid-1', queuedAt: '2026-07-02T09:00:00.000Z', payload: {idempotency_key: 'uuid-1'}}),
    );
    await outboxStore.add(
      makeEntry({id: 'uuid-2', queuedAt: '2026-07-02T09:05:00.000Z', payload: {idempotency_key: 'uuid-2'}}),
    );

    const resultPromise = firstValueFrom(service.syncNow());
    await settle();
    expectCsrfFetch().flush(meResponse());
    await settle();

    // Die Zurückweisung, mit der PRD #438 anfing — der Körper von
    // `test_the_collision_names_the_erstfang_that_holds_the_number`.
    expectCreatePost().flush(
      {
        ring_number: RING_ALREADY_FIRST_CAUGHT,
        errors: [
          {
            field: 'ring_number',
            code: 'ring_already_first_caught',
            detail: RING_ALREADY_FIRST_CAUGHT,
            context: RIVAL,
          },
        ],
      },
      {status: 400, statusText: 'Bad Request'},
    );
    await settle();

    // Ein Synchronisierungsfehler hält die Warteschlange nicht auf.
    expectCreatePost().flush({id: 'server-2'});
    await settle();

    expect(await resultPromise).toEqual({total: 2, synced: 1, flagged: 1});

    const flagged = (await outboxStore.list())[0];
    expect(flagged.id).toBe('uuid-1');
    // Die deutsche Zeile steht, wo sie seit #164 steht — unverändert.
    expect(flagged.syncError).toBe(RING_ALREADY_FIRST_CAUGHT);
    // Und daneben der ganze Fehlschlag: Klasse, Code, Text, Feld, Kontext.
    expect(flagged.syncErrorEnvelope).toEqual({
      klasse: Fehlerklasse.Korrigieren,
      code: 'ring_already_first_caught',
      field: 'ring_number',
      detail: RING_ALREADY_FIRST_CAUGHT,
      context: RIVAL,
    });
  });

  it('erfindet keinen Code, wo der Server keinen mitschickte', async () => {
    // Ein Endpunkt, der seinen `Response` von Hand baut, durchläuft keinen
    // Exception-Handler und trägt bis heute keinen Umschlag. Der Satz trägt
    // dann alles, was es gibt — und mehr wird nicht dazuerfunden.
    auth.currentUser.set(authUser());
    await outboxStore.add(makeEntry({id: 'uuid-1', payload: {idempotency_key: 'uuid-1'}}));

    const resultPromise = firstValueFrom(service.syncNow());
    await settle();
    expectCsrfFetch().flush(meResponse());
    await settle();

    expectCreatePost().flush(
      {detail: 'Diese Station wurde archiviert.'},
      {status: 400, statusText: 'Bad Request'},
    );
    await settle();

    expect(await resultPromise).toEqual({total: 1, synced: 0, flagged: 1});

    const flagged = (await outboxStore.list())[0];
    expect(flagged.syncError).toBe('Diese Station wurde archiviert.');
    expect(flagged.syncErrorEnvelope).toEqual({
      klasse: Fehlerklasse.Korrigieren,
      code: null,
      field: null,
      detail: 'Diese Station wurde archiviert.',
      context: null,
    });
  });

  it('lässt einen zurückgewiesenen Eintrag ohne Netz kein zweites Mal fragen', async () => {
    // Kein Nachfassen (ADR 0038): der Fehlschlag ist selbsttragend, also stellt
    // der Replay keine zweite Anfrage, um den kollidierenden Erstfang
    // nachzuladen — eine, die selbst scheitern könnte, und die es offline
    // ohnehin nie gäbe. `httpMock.verify()` im afterEach hält das fest.
    auth.currentUser.set(authUser());
    await outboxStore.add(makeEntry({id: 'uuid-1', payload: {idempotency_key: 'uuid-1'}}));

    const resultPromise = firstValueFrom(service.syncNow());
    await settle();
    expectCsrfFetch().flush(meResponse());
    await settle();

    expectCreatePost().flush(
      {
        ring_number: RING_ALREADY_FIRST_CAUGHT,
        errors: [
          {
            field: 'ring_number',
            code: 'ring_already_first_caught',
            detail: RING_ALREADY_FIRST_CAUGHT,
            context: RIVAL,
          },
        ],
      },
      {status: 400, statusText: 'Bad Request'},
    );
    await settle();

    expect(await resultPromise).toEqual({total: 1, synced: 0, flagged: 1});
    httpMock.expectNone(() => true);
  });
});
