import {LOCALE_ID, signal} from '@angular/core';
import {ComponentFixture, TestBed} from '@angular/core/testing';
import {registerLocaleData} from '@angular/common';
import localeDeAt from '@angular/common/locales/de-AT';
import {provideRouter, Router} from '@angular/router';
import {provideHttpClient} from '@angular/common/http';
import {HttpTestingController, provideHttpClientTesting} from '@angular/common/http/testing';
import {provideNoopAnimations} from '@angular/platform-browser/animations';
import {MatDialog} from '@angular/material/dialog';
import {of} from 'rxjs';

import {TodaySessionComponent} from './today-session';
import {ProjectService} from '../service/project.service';
import {Project} from '../models/project.model';
import {BirdStatus, DataEntry} from '../models/data-entry.model';
import {RingSize} from '../models/ring.model';
import {AuthService} from '../service/auth.service';
import {ConnectivityService} from '../core/offline/connectivity';
import {OutboxStoreService} from '../core/offline/outbox-store';
import {OutboxService} from '../service/outbox.service';
import {ReferenceBundleCacheService} from '../core/offline/reference-bundle-cache';
import {DataEntryDetailDialogComponent} from '../data-entry-form/data-entry-detail-dialog/data-entry-detail-dialog';
import {ConfirmDialogComponent} from '../shared/confirm-dialog/confirm-dialog';

registerLocaleData(localeDeAt);

const PROJECT: Project = {
  id: 'p1',
  title: 'Herbst',
  description: '',
  show_optional_fields: true,
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
    has_mites: false,
    has_hunger_stripes: false,
    has_brood_patch: false,
    has_cpl_plus: false,
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

  async function setup(project: Project | null = PROJECT): Promise<void> {
    dialog = jasmine.createSpyObj('MatDialog', ['open']);

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

  function flushSyncedEntries(entries: DataEntry[] = []): void {
    const req = httpMock.expectOne(
      (r) => r.method === 'GET' && r.url.endsWith('/birds/data-entries/'),
    );
    req.flush({count: entries.length, next: null, previous: null, results: entries});
  }

  // Both the reference-cache read (species/Station/Beringer display lookup)
  // and, indirectly, the queued-entry resolution write through to the real
  // (unpatched by Zone) browser IndexedDB — only real elapsed time observes
  // their completion (same pattern as offline-readiness.spec.ts).
  function settle(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 20));
  }

  afterEach(async () => {
    await TestBed.inject(OutboxStoreService).remove('outbox-uuid-1');
    await TestBed.inject(OutboxStoreService).remove('outbox-uuid-2');
    await TestBed.inject(ReferenceBundleCacheService).clear();
  });

  it('creates', async () => {
    await setup();
    fixture.detectChanges();
    flushSyncedEntries([]);
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
          last_consumed_ring_numbers: [],
        },
        refreshedAt: '2026-07-02T08:00:00.000Z',
      });

      await setup();
      fixture.detectChanges();
      flushSyncedEntries([]);
      await settle();
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('Kohlmeise');
      expect(text).toContain('V 0043');
      expect(text).toContain('Filip Reiter');
      expect(text).toContain('nicht synchronisiert');
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
      flushSyncedEntries([]);
      await settle();
      fixture.detectChanges();

      const row = fixture.nativeElement.querySelector('.session-row--queued') as HTMLElement;
      expect(row.classList).toContain('session-row--error');
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
      flushSyncedEntries([]);
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

    it('opens a queued entry in the capture form on click', async () => {
      await TestBed.inject(OutboxStoreService).add({
        id: 'outbox-uuid-1',
        accountKey: 'fre',
        payload: queuedPayload(),
        queuedAt: '2026-07-02T09:00:00.000Z',
      });
      await TestBed.inject(OutboxService).ready;

      await setup();
      fixture.detectChanges();
      flushSyncedEntries([]);
      await settle();
      fixture.detectChanges();

      const router = TestBed.inject(Router);
      const navigateSpy = spyOn(router, 'navigate').and.resolveTo(true);

      (fixture.nativeElement.querySelector('.session-row--queued') as HTMLElement).click();

      expect(navigateSpy).toHaveBeenCalledWith(['/data-entry', 'outbox-uuid-1']);
    });

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
      flushSyncedEntries([]);
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
      const stored = await TestBed.inject(OutboxStoreService).listForAccount('fre');
      expect(stored).toEqual([]);
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
      flushSyncedEntries([]);
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
      flushSyncedEntries([entry]);
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('Kohlmeise');
      expect(text).toContain('synchronisiert');
    });

    it('opens a synced entry in the capture form on click while online', async () => {
      await setup();
      fixture.detectChanges();
      flushSyncedEntries([syncedEntry({id: 'server-1'})]);
      fixture.detectChanges();

      const router = TestBed.inject(Router);
      const navigateSpy = spyOn(router, 'navigate').and.resolveTo(true);

      (fixture.nativeElement.querySelector('.session-row--synced') as HTMLElement).click();

      expect(navigateSpy).toHaveBeenCalledWith(['/data-entry', 'server-1']);
    });

    it('opens the read-only detail dialog instead of navigating when offline', async () => {
      await setup();
      fixture.detectChanges();
      const entry = syncedEntry({id: 'server-1'});
      flushSyncedEntries([entry]);
      fixture.detectChanges();

      TestBed.inject(ConnectivityService).markOffline();
      dialog.open.and.returnValue({afterClosed: () => of(undefined)} as never);
      const router = TestBed.inject(Router);
      const navigateSpy = spyOn(router, 'navigate').and.resolveTo(true);

      (fixture.nativeElement.querySelector('.session-row--synced') as HTMLElement).click();

      expect(navigateSpy).not.toHaveBeenCalled();
      expect(dialog.open).toHaveBeenCalledWith(
        DataEntryDetailDialogComponent,
        jasmine.objectContaining({data: entry}),
      );
    });
  });
});
