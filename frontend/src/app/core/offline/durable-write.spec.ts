import {TestBed} from '@angular/core/testing';
import {provideHttpClient} from '@angular/common/http';
import {HttpTestingController, provideHttpClientTesting} from '@angular/common/http/testing';
import {firstValueFrom} from 'rxjs';

import {DURABLE_WRITE} from './durable-write';
import {SESSION_EXPIRY_AT_THE_GESTURE} from '../errors/session-expiry';
import {IndexedDbStore} from './indexed-db-store';
import {OutboxStoreService} from './outbox-store';
import {PendingBeringerStoreService} from './pending-beringer-store';
import {ApiService} from '../../service/api.service';
import {AuthService} from '../../service/auth.service';
import {DataAccessFacadeService} from '../../service/data-access-facade.service';
import {DataEntry} from '../../models/data-entry.model';
import {Projekttyp} from '../../models/project.model';

/**
 * ADR 0039s Tabelle, an der Leitung geprüft (#447): **dauerhaft ist, was sonst
 * nirgends existiert.** Ein Schreibvorgang, der nur ändert, was der Server
 * bereits hält, scheitert laut — und darf deshalb weder markiert sein noch
 * irgendetwas einreihen.
 *
 * Die Regel steht hier an einer Stelle, statt über die Bildschirme verteilt: sie
 * ist die Antwort für die nächste Funktion, nicht für die letzte.
 */
describe('die Dauerhaftigkeit (#447, ADR 0039)', () => {
  let httpMock: HttpTestingController;
  let api: ApiService;
  let facade: DataAccessFacadeService;

  const NOT_AUTHENTICATED = {
    detail: 'Anmeldedaten fehlen.',
    errors: [{field: null, code: 'not_authenticated', detail: 'Anmeldedaten fehlen.'}],
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    api = TestBed.inject(ApiService);
    facade = TestBed.inject(DataAccessFacadeService);
    TestBed.inject(AuthService).currentUser.set({
      username: 'fre',
      handle: 'FRE',
      isStaff: false,
      rolle: 'mitglied',
      organization: null,
    });
  });

  afterEach(async () => {
    httpMock.verify();
    const db = TestBed.inject(IndexedDbStore);
    const queued = await db.getAll<{id: string}>('outbox');
    await Promise.all(queued.map((entry) => db.delete('outbox', entry.id)));
    const beringer = await db.getAll<{id: string}>('pendingBeringer');
    await Promise.all(beringer.map((entry) => db.delete('pendingBeringer', entry.id)));
  });

  /** Nichts liegt lokal — weder ein Fang noch ein Beringer. */
  async function expectNothingQueued(): Promise<void> {
    expect(await TestBed.inject(OutboxStoreService).list()).toEqual([]);
    expect(await TestBed.inject(PendingBeringerStoreService).list()).toEqual([]);
  }

  describe('dauerhaft — der Inhalt existiert sonst nirgends', () => {
    it('markiert den Fang-Create, damit der Redirect wartet, bis er sicher ist', async () => {
      const create = firstValueFrom(
        facade.createDataEntry({idempotency_key: 'uuid-1'} as unknown as Partial<DataEntry>),
      );
      create.catch(() => undefined);

      const req = httpMock.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'),
      );
      expect(req.request.context.get(DURABLE_WRITE)).toBeTrue();
      expect(req.request.context.get(SESSION_EXPIRY_AT_THE_GESTURE)).toBeTrue();
      req.flush(NOT_AUTHENTICATED, {status: 401, statusText: 'Unauthorized'});

      await expectAsync(create).toBeRejected();
      expect((await TestBed.inject(OutboxStoreService).list()).length).toBe(1);
    });

    it('markiert die Beringer-Schnellanlage ebenso — sie entsteht an einer Station ohne Empfang', async () => {
      const create = firstValueFrom(
        facade.createScientist({first_name: 'Filip', last_name: 'Reiter', handle: 'FRE'}),
      );
      create.catch(() => undefined);

      const req = httpMock.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/birds/scientists/'),
      );
      expect(req.request.context.get(DURABLE_WRITE)).toBeTrue();
      expect(req.request.context.get(SESSION_EXPIRY_AT_THE_GESTURE)).toBeTrue();
      req.flush(NOT_AUTHENTICATED, {status: 401, statusText: 'Unauthorized'});

      await expectAsync(create).toBeRejected();
      expect((await TestBed.inject(PendingBeringerStoreService).list()).length).toBe(1);
    });
  });

  describe('scheitert laut — jederzeit in Ruhe erneut einzugeben', () => {
    it('reiht einen Fang-Edit nicht ein: das Original ist unversehrt', async () => {
      const update = firstValueFrom(facade.updateDataEntry('42', {comment: 'Korrektur'} as never));
      update.catch(() => undefined);

      const req = httpMock.expectOne(
        (r) => r.method === 'PUT' && r.url.endsWith('/birds/data-entries/42/'),
      );
      expect(req.request.context.get(DURABLE_WRITE)).toBeFalse();
      req.flush(NOT_AUTHENTICATED, {status: 401, statusText: 'Unauthorized'});

      await expectAsync(update).toBeRejected();
      await expectNothingQueued();
    });

    // Der eine Unterschied zu Station, Projekt und Artennorm — und er ist kein
    // Einreihen: die Korrektur steht im Formular und sonst nirgends, also wird
    // der Fehlschlag dort gemeldet, wo die Geste stattfand (ADR 0037), statt
    // das Formular mit einem Sprung zur Anmeldung wegzunehmen. Was das an der
    // Leitung bedeutet, prüft `auth.interceptor.spec.ts`; was es am Formular
    // bedeutet, `data-entry-form.spec.ts`.
    it('markiert den Fang-Edit trotzdem: sein 401 wird am Formular gemeldet, nicht mit einem Sprung zur Anmeldung', async () => {
      const update = firstValueFrom(facade.updateDataEntry('42', {comment: 'Korrektur'} as never));
      update.catch(() => undefined);

      const req = httpMock.expectOne(
        (r) => r.method === 'PUT' && r.url.endsWith('/birds/data-entries/42/'),
      );
      expect(req.request.context.get(SESSION_EXPIRY_AT_THE_GESTURE)).toBeTrue();
      req.flush(NOT_AUTHENTICATED, {status: 401, statusText: 'Unauthorized'});

      await expectAsync(update).toBeRejected();
      await expectNothingQueued();
    });

    it('reiht eine Station nicht ein', async () => {
      const create = firstValueFrom(api.createRingingStation({name: 'Linz'} as never));
      create.catch(() => undefined);

      const req = httpMock.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/birds/ringing-stations/'),
      );
      expect(req.request.context.get(DURABLE_WRITE)).toBeFalse();
      expect(req.request.context.get(SESSION_EXPIRY_AT_THE_GESTURE)).toBeFalse();
      req.flush(NOT_AUTHENTICATED, {status: 401, statusText: 'Unauthorized'});

      await expectAsync(create).toBeRejected();
      await expectNothingQueued();
    });

    it('reiht ein Projekt nicht ein', async () => {
      const create = firstValueFrom(
        api.createProject({title: 'Herbst', projekttyp: Projekttyp.Sonstiges} as never),
      );
      create.catch(() => undefined);

      const req = httpMock.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/birds/projects/'),
      );
      expect(req.request.context.get(DURABLE_WRITE)).toBeFalse();
      expect(req.request.context.get(SESSION_EXPIRY_AT_THE_GESTURE)).toBeFalse();
      req.flush(NOT_AUTHENTICATED, {status: 401, statusText: 'Unauthorized'});

      await expectAsync(create).toBeRejected();
      await expectNothingQueued();
    });

    it('reiht eine Artennorm nicht ein', async () => {
      const save = firstValueFrom(
        api.saveSpeciesNormOverride({species_id: 's1', weight_gram_min: 12} as never),
      );
      save.catch(() => undefined);

      const req = httpMock.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/birds/species-norm-overrides/'),
      );
      expect(req.request.context.get(DURABLE_WRITE)).toBeFalse();
      expect(req.request.context.get(SESSION_EXPIRY_AT_THE_GESTURE)).toBeFalse();
      req.flush(NOT_AUTHENTICATED, {status: 401, statusText: 'Unauthorized'});

      await expectAsync(save).toBeRejected();
      await expectNothingQueued();
    });

    it('markiert auch den Replay des Sync nicht — dort ist der 401 die Bedingung des Laufs (ADR 0033)', async () => {
      // Derselbe Endpunkt, andere Bedeutung: was der Sync zurückspielt, liegt
      // längst dauerhaft in der Outbox. Ein 401 lässt die Warteschlange
      // unangetastet und führt zur Anmeldung — wie eh und je.
      const replay = firstValueFrom(api.createDataEntry({idempotency_key: 'uuid-1'} as never));
      replay.catch(() => undefined);

      const req = httpMock.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'),
      );
      expect(req.request.context.get(DURABLE_WRITE)).toBeFalse();
      expect(req.request.context.get(SESSION_EXPIRY_AT_THE_GESTURE)).toBeFalse();
      req.flush(NOT_AUTHENTICATED, {status: 401, statusText: 'Unauthorized'});

      await expectAsync(replay).toBeRejected();
      await expectNothingQueued();
    });
  });
});
