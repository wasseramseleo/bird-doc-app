import {LOCALE_ID, signal} from '@angular/core';
import {ComponentFixture, TestBed} from '@angular/core/testing';
import {registerLocaleData} from '@angular/common';
import localeDeAt from '@angular/common/locales/de-AT';
import {provideRouter, Router} from '@angular/router';
import {provideHttpClient} from '@angular/common/http';
import {HttpTestingController, provideHttpClientTesting} from '@angular/common/http/testing';
import {provideNoopAnimations} from '@angular/platform-browser/animations';
import {MatDialog} from '@angular/material/dialog';
import {MatSnackBar} from '@angular/material/snack-bar';
import {of, throwError} from 'rxjs';

import {TodaySessionComponent} from './today-session';
import {AppIconErrorDirective} from '../shared/app-icons';
import {renderedGlyph, seamGlyph} from '../shared/app-icons.testing';
import {ProjectService} from '../service/project.service';
import {Project, Projekttyp} from '../models/project.model';
import {BirdStatus, DataEntry} from '../models/data-entry.model';
import {RingSize} from '../models/ring.model';
import {AuthService} from '../service/auth.service';
import {ConnectivityService} from '../core/offline/connectivity';
import {OutboxStoreService} from '../core/offline/outbox-store';
import {IndexedDbStore} from '../core/offline/indexed-db-store';
import {OutboxService} from '../service/outbox.service';
import {ReferenceBundleCacheService} from '../core/offline/reference-bundle-cache';
import {RecentEntriesCacheService} from '../core/offline/recent-entries-cache';
import {DetailDialogOpener} from '../shared/detail-dialog/detail-dialog-opener';
import {NICHT_AUF_DIESEM_GERAET_BEKANNT} from '../shared/detail-dialog/fang-lesemodell';
import {OutboxEntry} from '../models/outbox-entry.model';
import {ConfirmDialogComponent} from '../shared/confirm-dialog/confirm-dialog';

registerLocaleData(localeDeAt);

const PROJECT: Project = {
  id: 'p1',
  title: 'Herbst',
  description: '',
  projekttyp: Projekttyp.Sonstiges,
  organization: {id: 'o1', handle: 'IWM', name: 'IWM Linz', country: 'AT'},
  default_station: null,
  scientists: [],
  created: '',
  updated: '',
} as Project;

const STATION = {handle: 'STAMT', name: 'Linz, Botanischer Garten'};
const STAFF = {id: 'sci-1', handle: 'FRE', full_name: 'Filip Reiter'};
const KOHLMEISE = {
  id: 's1',
  common_name_de: 'Kohlmeise',
  common_name_en: 'Great Tit',
  scientific_name: 'Parus major',
  family_name: '',
  order_name: '',
  ring_size: RingSize.V,
  special_kind: '' as const,
};

function isoNow(): string {
  return new Date().toISOString();
}

function syncedEntry(overrides: Partial<DataEntry> = {}): DataEntry {
  return {
    id: 'server-1',
    species: KOHLMEISE,
    ring: {id: 'r1', number: '0099', size: 'V'},
    staff: STAFF,
    ringing_station: STATION,
    project: null,
    net_location: null,
    net_height: null,
    net_direction: null,
    feather_span: null,
    wing_span: null,
    tarsus: null,
    notch_f2: null,
    inner_foot: null,
    weight_gram: null,
    bird_status: BirdStatus.FirstCatch,
    fat_deposit: null,
    muscle_class: null,
    age_class: 2,
    sex: 0,
    small_feather_int: null,
    small_feather_app: null,
    hand_wing: null,
    date_time: isoNow(),
    created: isoNow(),
    updated: isoNow(),
    comment: null,
    parasites: [],
    has_hunger_stripes: false,
    has_brood_patch: false,
    has_cpl_plus: false,
    is_dead_recovery: false,
    is_non_standard: false,
    ...overrides,
  } as DataEntry;
}

function queuedPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ringing_station_id: 'STAMT',
    staff_id: 'sci-1',
    date_time: '2026-07-02T09:00',
    species_id: 's1',
    bird_status: BirdStatus.FirstCatch,
    ring_size: 'V',
    ring_number: '0043',
    idempotency_key: 'outbox-uuid-1',
    project_id: 'p1',
    ...overrides,
  };
}

describe('TodaySessionComponent', () => {
  let fixture: ComponentFixture<TodaySessionComponent>;
  let component: TodaySessionComponent;
  let httpMock: HttpTestingController;
  let dialog: jasmine.SpyObj<MatDialog>;
  let detailDialog: jasmine.SpyObj<DetailDialogOpener>;

  async function setup(project: Project | null = PROJECT): Promise<void> {
    dialog = jasmine.createSpyObj('MatDialog', ['open']);
    detailDialog = jasmine.createSpyObj('DetailDialogOpener', ['open', 'openQueued']);

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [TodaySessionComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        {provide: LOCALE_ID, useValue: 'de-AT'},
        {
          provide: ProjectService,
          useValue: {
            currentProject: signal<Project | null>(project),
            setCurrent: () => {},
            clear: () => {},
          },
        },
        {provide: MatDialog, useValue: dialog},
        {provide: DetailDialogOpener, useValue: detailDialog},
      ],
    }).compileComponents();

    TestBed.inject(AuthService).currentUser.set({
      username: 'fre',
      handle: 'FRE',
      isStaff: false,
      rolle: 'mitglied',
      organization: null,
    });

    fixture = TestBed.createComponent(TodaySessionComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  }

  // A successful fetch makes `DataAccessFacadeService.getTodayEntries()` write the
  // `recentEntries` cache fire-and-forget — deliberately best effort in production
  // (#402), but a leak in the suite: unobserved, the write lands *after* this
  // spec's own `afterEach`, in the middle of a later spec file, and whichever spec
  // then reads a virgin `recentEntries` store finds this Projekt's row instead.
  // A cleanup cannot clean up a write that has not happened yet — so awaiting
  // `settle()` here keeps the write inside the test that caused it. Same shape as
  // `flushBundleRequest()` in `offline-readiness.spec.ts`; every call site awaits.
  async function flushSyncedEntries(entries: DataEntry[] = []): Promise<void> {
    const req = httpMock.expectOne(
      (r) => r.method === 'GET' && r.url.endsWith('/birds/data-entries/'),
    );
    req.flush({count: entries.length, next: null, previous: null, results: entries});
    await settle();
  }

  // Both the reference-cache read (species/Station/Beringer display lookup)
  // and, indirectly, the queued-entry resolution write through to the real
  // (unpatched by Zone) browser IndexedDB — the store reports when that work is
  // done (issue #464), which a fixed 20 ms budget only guessed at.
  function settle(): Promise<void> {
    return TestBed.inject(IndexedDbStore).whenIdle();
  }

  afterEach(async () => {
    await TestBed.inject(OutboxStoreService).remove('outbox-uuid-1');
    await TestBed.inject(OutboxStoreService).remove('outbox-uuid-2');
    await TestBed.inject(ReferenceBundleCacheService).clear();
    // The third cache this spec writes into the shared, real browser IndexedDB —
    // via the fire-and-forget write-through of a successful today-fetch (#402).
    await TestBed.inject(RecentEntriesCacheService).clear();
  });

  it('creates', async () => {
    await setup();
    fixture.detectChanges();
    await flushSyncedEntries([]);
    expect(component).toBeTruthy();
  });

  describe('queued (nicht synchronisiert) entries', () => {
    it('lists a queued entry, resolved from the cached reference bundle, as nicht synchronisiert', async () => {
      await TestBed.inject(OutboxStoreService).add({
        id: 'outbox-uuid-1',
        accountKey: 'fre',
        payload: queuedPayload(),
        queuedAt: '2026-07-02T09:00:00.000Z',
      });
      await TestBed.inject(OutboxService).ready;
      await TestBed.inject(ReferenceBundleCacheService).save({
        bundle: {
          identity: {username: 'fre', handle: 'FRE', organization: null, rolle: 'mitglied'},
          species: [{...KOHLMEISE, usage_count: 0}],
          ringing_stations: [STATION],
          scientists: [STAFF],
          projects: [],
          centrals: [],
          last_consumed_ring_numbers: [],
        },
        refreshedAt: '2026-07-02T08:00:00.000Z',
      });

      await setup();
      fixture.detectChanges();
      await flushSyncedEntries([]);
      await settle();
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('Kohlmeise');
      expect(text).toContain('V 0043');
      expect(text).toContain('Filip Reiter');
      expect(text).toContain('nicht synchronisiert');
    });

    // #469: „Heute", nicht synchronisiert. Ein Ring-vernichtet-Eintrag trägt
    // schon in der Outbox keinen Ringstatus — das Formular lässt das Feld leer,
    // sobald die Sonderart gewählt ist —, und die Zeile zeigt diese Abwesenheit
    // als Gedankenstrich statt als „Wiederfang".
    it('reads a queued Ring-vernichtet capture as a dash, not as Wiederfang', async () => {
      await TestBed.inject(OutboxStoreService).add({
        id: 'outbox-uuid-1',
        accountKey: 'fre',
        payload: queuedPayload({bird_status: null}),
        queuedAt: '2026-07-02T09:00:00.000Z',
      });
      await TestBed.inject(OutboxService).ready;

      await setup();
      fixture.detectChanges();
      await flushSyncedEntries([]);
      await settle();
      fixture.detectChanges();

      const status = fixture.nativeElement.querySelector(
        '.session-row--queued .session-row__status',
      ) as HTMLElement;
      expect(status.textContent?.trim()).toBe('—');
    });

    it('names the Ringstatus of a queued capture that has one', async () => {
      await TestBed.inject(OutboxStoreService).add({
        id: 'outbox-uuid-1',
        accountKey: 'fre',
        payload: queuedPayload({bird_status: BirdStatus.ReCatch}),
        queuedAt: '2026-07-02T09:00:00.000Z',
      });
      await TestBed.inject(OutboxService).ready;

      await setup();
      fixture.detectChanges();
      await flushSyncedEntries([]);
      await settle();
      fixture.detectChanges();

      const status = fixture.nativeElement.querySelector(
        '.session-row--queued .session-row__status',
      ) as HTMLElement;
      expect(status.textContent?.trim()).toBe('Wiederfang');
    });

    it('flags a server-rejected queued entry with its sync error (issue #164)', async () => {
      await TestBed.inject(OutboxStoreService).add({
        id: 'outbox-uuid-1',
        accountKey: 'fre',
        payload: queuedPayload(),
        queuedAt: '2026-07-02T09:00:00.000Z',
        syncError: 'Für diese Ringnummer besteht in dieser Organisation bereits ein Erstfang.',
      });
      await TestBed.inject(OutboxService).ready;

      await setup();
      fixture.detectChanges();
      await flushSyncedEntries([]);
      await settle();
      fixture.detectChanges();

      const row = fixture.nativeElement.querySelector('.session-row--queued') as HTMLElement;
      expect(row.classList).toContain('session-row--error');
      // #439: am gezeichneten Ergebnis geprüft, nicht am Marker im Template —
      // `app-icon-error` ohne die Direktive in `imports` ist für Angular kein
      // Fehler und ließe das Abzeichen im Browser ohne Icon.
      expect(renderedGlyph(row.querySelector('.session-row__badge--error mat-icon'))).toBeTruthy();
      expect(seamGlyph(fixture, AppIconErrorDirective)).toBeTruthy();
      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('Sync-Fehler');
      expect(text).toContain(
        'Für diese Ringnummer besteht in dieser Organisation bereits ein Erstfang.',
      );
    });

    it('hides a queued entry from a different Projekt than the active one (review fix)', async () => {
      await TestBed.inject(OutboxStoreService).add({
        id: 'outbox-uuid-1',
        accountKey: 'fre',
        payload: queuedPayload({project_id: 'p1'}),
        queuedAt: '2026-07-02T09:00:00.000Z',
      });
      await TestBed.inject(OutboxStoreService).add({
        id: 'outbox-uuid-2',
        accountKey: 'fre',
        payload: queuedPayload({project_id: 'p2', idempotency_key: 'outbox-uuid-2'}),
        queuedAt: '2026-07-02T09:05:00.000Z',
      });
      await TestBed.inject(OutboxService).ready;

      await setup();
      fixture.detectChanges();
      await flushSyncedEntries([]);
      await settle();
      fixture.detectChanges();

      expect(component.queuedRows().map((row) => row.id)).toEqual(['outbox-uuid-1']);
      expect(
        fixture.nativeElement.querySelectorAll('.session-row--queued').length,
      ).toBe(1);
    });

    it('shows no queued entries when no Projekt is active (review fix)', async () => {
      await TestBed.inject(OutboxStoreService).add({
        id: 'outbox-uuid-1',
        accountKey: 'fre',
        payload: queuedPayload({project_id: 'p1'}),
        queuedAt: '2026-07-02T09:00:00.000Z',
      });
      await TestBed.inject(OutboxService).ready;

      await setup(null);
      fixture.detectChanges();
      await settle();
      fixture.detectChanges();

      expect(component.queuedRows()).toEqual([]);
      expect(fixture.nativeElement.querySelectorAll('.session-row--queued').length).toBe(0);
    });

    // #495 (PRD #491, ADR 0042): auch die **nicht synchronisierte** Zeile öffnet
    // den Detail-Dialog — dieselbe Geste wie im synchronisierten Abschnitt
    // darunter und in jeder anderen Fang-Tabelle. Bis hierher navigierte sie
    // direkt in die Warteschlangen-Bearbeitung; dorthin führt jetzt der
    // „Bearbeiten"-Knopf im Dialog.
    //
    // Kompositions-Pin dieser Tabelle: **genau einmal**, und kein Routenwechsel.
    it('opens the detail dialog exactly once on a queued row click', async () => {
      const eintrag = {
        id: 'outbox-uuid-1',
        accountKey: 'fre',
        payload: queuedPayload(),
        queuedAt: '2026-07-02T09:00:00.000Z',
      };
      await TestBed.inject(OutboxStoreService).add(eintrag);
      await TestBed.inject(OutboxService).ready;

      await setup();
      fixture.detectChanges();
      await flushSyncedEntries([]);
      await settle();
      fixture.detectChanges();

      const router = TestBed.inject(Router);
      const navigateSpy = spyOn(router, 'navigate').and.resolveTo(true);

      (fixture.nativeElement.querySelector('.session-row--queued') as HTMLElement).click();

      expect(navigateSpy).not.toHaveBeenCalled();
      expect(detailDialog.openQueued).toHaveBeenCalledTimes(1);
      const uebergeben = detailDialog.openQueued.calls.mostRecent().args[0] as OutboxEntry;
      expect(uebergeben.id).toBe('outbox-uuid-1');
    });

    /**
     * #495: die Zeile und der Dialog, den sie öffnet, sagen **dasselbe**. Eine
     * Referenz, die dieses Gerät nicht auflösen kann, heißt hier wie dort „auf
     * diesem Gerät nicht bekannt" — und nicht Gedankenstrich, der als „nicht
     * erfasst" gelesen würde und die Beringer:in an ihrer eigenen Erfassung
     * zweifeln ließe.
     */
    it('names an unresolvable reference in the row exactly as the dialog does', async () => {
      await TestBed.inject(OutboxStoreService).add({
        id: 'outbox-uuid-1',
        accountKey: 'fre',
        payload: queuedPayload(),
        queuedAt: '2026-07-02T09:00:00.000Z',
      });
      await TestBed.inject(OutboxService).ready;

      // Kein zwischengespeichertes Bundle: das Gerät kann Art und Beringer:in
      // nicht nachschlagen.
      await setup();
      fixture.detectChanges();
      await flushSyncedEntries([]);
      await settle();
      fixture.detectChanges();

      const row = fixture.nativeElement.querySelector('.session-row--queued') as HTMLElement;
      const species = row.querySelector('.session-row__species') as HTMLElement;
      const staff = row.querySelector('.session-row__staff') as HTMLElement;
      expect(species.textContent!.trim()).toBe(NICHT_AUF_DIESEM_GERAET_BEKANNT);
      expect(staff.textContent!.trim()).toBe(NICHT_AUF_DIESEM_GERAET_BEKANNT);
      expect(species.textContent!.trim()).not.toBe('—');
      // Ringgröße und Ringnummer brauchen kein Nachschlagen — sie stehen da.
      expect((row.querySelector('.session-row__ring') as HTMLElement).textContent!.trim()).toBe(
        'V 0043',
      );
    });

    // #494: der Lösch-Knopf bleibt ein Lösch-Knopf. Er löst die Löschbestätigung
    // aus und **keinen** Detail-Dialog — sein Klick darf die Zeile nicht
    // erreichen, sonst hieße Löschen auch Lesen.
    it('deletes a queued entry after confirmation, without navigating', async () => {
      await TestBed.inject(OutboxStoreService).add({
        id: 'outbox-uuid-1',
        accountKey: 'fre',
        payload: queuedPayload(),
        queuedAt: '2026-07-02T09:00:00.000Z',
      });
      await TestBed.inject(OutboxService).ready;

      await setup();
      fixture.detectChanges();
      await flushSyncedEntries([]);
      await settle();
      fixture.detectChanges();

      dialog.open.and.returnValue({afterClosed: () => of(true)} as never);
      const router = TestBed.inject(Router);
      const navigateSpy = spyOn(router, 'navigate').and.resolveTo(true);

      const deleteButton = fixture.nativeElement.querySelector(
        '.session-row--queued [data-testid="delete-queued"]',
      ) as HTMLElement;
      deleteButton.click();
      await settle();

      expect(dialog.open).toHaveBeenCalledWith(ConfirmDialogComponent, jasmine.any(Object));
      expect(navigateSpy).not.toHaveBeenCalled();
      expect(detailDialog.open).not.toHaveBeenCalled();
      // #495: seit die Zeile den Detail-Dialog öffnet, ist das hier der Aufruf,
      // den der Lösch-Knopf nicht auslösen darf.
      expect(detailDialog.openQueued).not.toHaveBeenCalled();
      const stored = await TestBed.inject(OutboxStoreService).listForAccount('fre');
      expect(stored).toEqual([]);
    });

    // #448 (ADR 0037): auch „Heute" ist ein ausgelöster Schreibvorgang. Ein
    // gescheitertes Löschen toastete drei Sekunden und war weg, bevor der
    // Beringer — beide Hände am Vogel — hinsehen konnte.
    it('renders the banner instead of a snackbar when the delete fails', async () => {
      await TestBed.inject(OutboxStoreService).add({
        id: 'outbox-uuid-1',
        accountKey: 'fre',
        payload: queuedPayload(),
        queuedAt: '2026-07-02T09:00:00.000Z',
      });
      await TestBed.inject(OutboxService).ready;

      await setup();
      fixture.detectChanges();
      await flushSyncedEntries([]);
      await settle();
      fixture.detectChanges();

      const snack = spyOn(fixture.debugElement.injector.get(MatSnackBar), 'open');
      spyOn(TestBed.inject(OutboxService), 'delete').and.returnValue(
        throwError(() => new Error('IndexedDB hat den Schreibvorgang abgelehnt.')),
      );
      dialog.open.and.returnValue({afterClosed: () => of(true)} as never);

      const deleteButton = fixture.nativeElement.querySelector(
        '.session-row--queued [data-testid="delete-queued"]',
      ) as HTMLElement;
      deleteButton.click();
      await settle();
      fixture.detectChanges();

      const banner = fixture.nativeElement.querySelector('[data-testid="failure-banner"]');
      expect(banner).not.toBeNull();
      // Ein Fehlschlag ohne Transport dahinter fällt auf *Unbekannt* und
      // beschuldigt damit nie die Eingabe (ADR 0037).
      expect(banner.textContent).toContain('Unerwarteter Fehler');
      expect(snack).not.toHaveBeenCalled();
    });

    it('keeps the entry queued when the delete confirmation is cancelled', async () => {
      await TestBed.inject(OutboxStoreService).add({
        id: 'outbox-uuid-1',
        accountKey: 'fre',
        payload: queuedPayload(),
        queuedAt: '2026-07-02T09:00:00.000Z',
      });
      await TestBed.inject(OutboxService).ready;

      await setup();
      fixture.detectChanges();
      await flushSyncedEntries([]);
      await settle();
      fixture.detectChanges();

      dialog.open.and.returnValue({afterClosed: () => of(false)} as never);

      const deleteButton = fixture.nativeElement.querySelector(
        '.session-row--queued [data-testid="delete-queued"]',
      ) as HTMLElement;
      deleteButton.click();
      await settle();

      const stored = await TestBed.inject(OutboxStoreService).listForAccount('fre');
      expect(stored.map((e) => e.id)).toEqual(['outbox-uuid-1']);
    });
  });

  describe('synced (synchronisiert) entries', () => {
    it("lists today's synced entries fetched for the current Projekt", async () => {
      await setup();
      fixture.detectChanges();
      const entry = syncedEntry();
      await flushSyncedEntries([entry]);
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('Kohlmeise');
      expect(text).toContain('synchronisiert');
    });

    // #469: „Heute", synchronisiert — derselbe Satz auf dem zweiten Zweig. Der
    // Server hat den Ringstatus des Ring-vernichtet-Eintrags geleert; die Zeile
    // gibt die Abwesenheit wieder, statt sie zu „Wiederfang" zu ergänzen.
    it('reads a synced Ring-vernichtet capture as a dash, not as Wiederfang', async () => {
      await setup();
      fixture.detectChanges();
      await flushSyncedEntries([
        syncedEntry({
          species: {
            id: 'sent',
            common_name_de: 'Ring Vernichtet',
            scientific_name: '',
            special_kind: 'ring_destroyed',
          } as never,
          bird_status: null as never,
        }),
      ]);
      fixture.detectChanges();

      const status = fixture.nativeElement.querySelector(
        '.session-row--synced .session-row__status',
      ) as HTMLElement;
      expect(status.textContent?.trim()).toBe('—');
    });

    it('names the Ringstatus of a synced capture that has one', async () => {
      await setup();
      fixture.detectChanges();
      await flushSyncedEntries([syncedEntry({bird_status: BirdStatus.ReCatch})]);
      fixture.detectChanges();

      const status = fixture.nativeElement.querySelector(
        '.session-row--synced .session-row__status',
      ) as HTMLElement;
      expect(status.textContent?.trim()).toBe('Wiederfang');
    });

    // #494 (PRD #491): dieselbe Geste wie in jeder Fang-Tabelle — antippen heißt
    // „zeig mir diesen Fang". Bis hierher navigierte diese Zeile online in die
    // Bearbeitungsmaske und fiel nur offline auf den Dialog zurück; die
    // Fallunterscheidung entfällt ersatzlos, die Offline-Kenntnis sitzt seit
    // #493 auf dem „Bearbeiten"-Knopf im Dialog.
    //
    // Kompositions-Pin dieser Tabelle: **genau einmal**, und kein Routenwechsel.
    it('opens the detail dialog exactly once on a synced row click while online', async () => {
      await setup();
      fixture.detectChanges();
      const entry = syncedEntry({id: 'server-1'});
      await flushSyncedEntries([entry]);
      fixture.detectChanges();

      const router = TestBed.inject(Router);
      const navigateSpy = spyOn(router, 'navigate').and.resolveTo(true);

      (fixture.nativeElement.querySelector('.session-row--synced') as HTMLElement).click();

      expect(navigateSpy).not.toHaveBeenCalled();
      expect(detailDialog.open).toHaveBeenCalledOnceWith(entry);
    });

    // #494: offline geschieht **dasselbe** — kein Sonderfall, keine Degradation
    // eines Defaults, sondern die Regel. Ein synchronisierter Fang ist offline
    // nicht bearbeitbar; das sagt seit #493 der Knopf im Dialog, nicht mehr die
    // Zeile.
    it('opens the same detail dialog on a synced row click while offline', async () => {
      await setup();
      fixture.detectChanges();
      const entry = syncedEntry({id: 'server-1'});
      await flushSyncedEntries([entry]);
      fixture.detectChanges();

      TestBed.inject(ConnectivityService).markOffline();
      const router = TestBed.inject(Router);
      const navigateSpy = spyOn(router, 'navigate').and.resolveTo(true);

      (fixture.nativeElement.querySelector('.session-row--synced') as HTMLElement).click();

      expect(navigateSpy).not.toHaveBeenCalled();
      // #478 (ADR 0042): welche Komponente der Detail-Dialog ist, weiß seit
      // diesem Issue nur noch der geteilte Öffner. „Heute" sagt bloß, *dass* es
      // dieser Fang ist — die Konfiguration daneben ist nicht mehr ihre Sache.
      expect(detailDialog.open).toHaveBeenCalledOnceWith(entry);
    });

    // #494 (PRD #491, „bewusst unverändert"): das Zustands-Abzeichen beantwortet
    // die Sync-Frage („ist das schon oben?"), der Dialog die Fang-Frage. Beide
    // stehen nebeneinander — das Abzeichen verschwindet nicht, weil die Zeile
    // jetzt etwas anderes tut.
    it('keeps the synchronisiert badge on a synced row', async () => {
      await setup();
      fixture.detectChanges();
      await flushSyncedEntries([syncedEntry()]);
      fixture.detectChanges();

      const badge = fixture.nativeElement.querySelector(
        '.session-row--synced .session-row__badge--synced',
      ) as HTMLElement;
      expect(badge).not.toBeNull();
      expect(badge.textContent).toContain('synchronisiert');
    });
  });
});
