import { LOCALE_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { registerLocaleData } from '@angular/common';
import localeDeAt from '@angular/common/locales/de-AT';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { of } from 'rxjs';

import { DataEntryFormComponent } from './data-entry-form';
import {
  AgeClass,
  BirdStatus,
  DataEntry,
  Sex,
  SmallFeatherAppMoult,
  SmallFeatherIntMoult,
} from '../models/data-entry.model';
import { Species } from '../models/species.model';
import { DataAccessFacadeService, RingHistory } from '../service/data-access-facade.service';
import { ProjectService } from '../service/project.service';
import { Project } from '../models/project.model';
import { RingingStation } from '../models/ringing-station.model';
import { RingSize } from '../models/ring.model';
import { AUW_SCHEME_CODE, Central, PROJEKT_ZENTRALE } from '../models/central.model';
import { OutboxStoreService } from '../core/offline/outbox-store';
import { OutboxService } from '../service/outbox.service';
import { AuthService } from '../service/auth.service';
import { IndexedDbStore } from '../core/offline/indexed-db-store';
import { ReferenceBundleCacheService } from '../core/offline/reference-bundle-cache';
import { Scientist } from '../models/scientist.model';
import { SpeciesNorm } from '../core/plausibility/plausibility';
import { OfflineBundle } from '../models/offline-bundle.model';

registerLocaleData(localeDeAt);

describe('DataEntryFormComponent', () => {
  let component: DataEntryFormComponent;
  let fixture: ComponentFixture<DataEntryFormComponent>;

  // Shared create-mode setup for the #23 keyboard tests: a project so the form
  // does not redirect home, plus the one-off sentinel-Art fetch on init.
  const createProject = (): Project =>
    ({
      id: 'p1',
      title: 'Herbst',
      description: '',
      show_optional_fields: true,
      organization: { id: 'o1', handle: 'IWM', name: 'IWM Linz', country: 'AT' },
      default_station: null,
      scientists: [],
      created: '',
      updated: '',
    }) as Project;

  async function setupCreateMode(): Promise<HttpTestingController> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [DataEntryFormComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        {
          provide: ProjectService,
          useValue: {
            currentProject: signal<Project | null>(createProject()),
            setCurrent: () => {},
            clear: () => {},
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DataEntryFormComponent);
    component = fixture.componentInstance;
    const httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    httpMock
      .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/species/'))
      .flush({ count: 0, next: null, previous: null, results: [] });
    return httpMock;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DataEntryFormComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        { provide: LOCALE_ID, useValue: 'de-AT' },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DataEntryFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('creating a Beringer inline from an unknown Kürzel', () => {
    const dialogMock = { open: jasmine.createSpy('open') };
    let httpMock: HttpTestingController;

    beforeEach(async () => {
      TestBed.resetTestingModule();
      dialogMock.open.calls.reset();
      await TestBed.configureTestingModule({
        imports: [DataEntryFormComponent],
        providers: [
          provideRouter([]),
          provideHttpClient(),
          provideHttpClientTesting(),
          provideNoopAnimations(),
        ],
      })
        .overrideComponent(DataEntryFormComponent, {
          add: { providers: [{ provide: MatDialog, useValue: dialogMock }] },
        })
        .compileComponents();

      fixture = TestBed.createComponent(DataEntryFormComponent);
      component = fixture.componentInstance;
      httpMock = TestBed.inject(HttpTestingController);
      fixture.detectChanges();
    });

    it('opens the dialog with the typed Kürzel pre-filled', () => {
      dialogMock.open.and.returnValue({ afterClosed: () => of(undefined) });

      component.onCreateBeringer('FRE');

      expect(dialogMock.open).toHaveBeenCalled();
      const config = dialogMock.open.calls.mostRecent().args[1];
      expect(config.data).toEqual({ handle: 'FRE' });
    });

    it('creates the Beringer and selects it into the staff field on save', () => {
      const created = { id: '7', handle: 'FRE', full_name: 'Filip Reiter' };
      dialogMock.open.and.returnValue({
        afterClosed: () => of({ first_name: 'Filip', last_name: 'Reiter', handle: 'FRE' }),
      });

      component.onCreateBeringer('FRE');

      const req = httpMock.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/birds/scientists/'),
      );
      expect(req.request.body).toEqual({ first_name: 'Filip', last_name: 'Reiter', handle: 'FRE' });
      req.flush(created);

      expect(component.entryForm.get('staff')!.value).toEqual(created);
    });

    it('satisfies the selection validator once the new Beringer is created (#58)', () => {
      const created = { id: '7', handle: 'FRE', full_name: 'Filip Reiter' };
      dialogMock.open.and.returnValue({
        afterClosed: () => of({ first_name: 'Filip', last_name: 'Reiter', handle: 'FRE' }),
      });

      // The unknown Kürzel typed as free text would otherwise be an unmatched option.
      component.entryForm.get('staff')!.setValue('FRE' as never);
      expect(component.entryForm.get('staff')!.hasError('unmatchedOption')).toBe(true);

      component.onCreateBeringer('FRE');
      httpMock
        .expectOne((r) => r.method === 'POST' && r.url.endsWith('/birds/scientists/'))
        .flush(created);

      // Creation ends by setting the control to the created Beringer object.
      expect(component.entryForm.get('staff')!.hasError('unmatchedOption')).toBe(false);
      expect(component.entryForm.get('staff')!.valid).toBe(true);
    });
  });

  describe('pre-filling the Station from the Projekt default', () => {
    const station: RingingStation = {
      handle: 'STAMT',
      name: 'Linz, Botanischer Garten',
      organization: { id: 'o1', handle: 'IWM', name: 'IWM Linz', country: 'AT' },
    };
    const project = {
      id: 'p1',
      title: 'Herbst',
      description: '',
      show_optional_fields: true,
      organization: station.organization!,
      default_station: station,
      scientists: [],
      created: '',
      updated: '',
    } as Project;

    async function setupWith(currentProject: Project | null) {
      const projectServiceStub = {
        currentProject: signal<Project | null>(currentProject),
        setCurrent: () => {},
        clear: () => {},
      };
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [DataEntryFormComponent],
        providers: [
          provideRouter([]),
          provideHttpClient(),
          provideHttpClientTesting(),
          provideNoopAnimations(),
          { provide: ProjectService, useValue: projectServiceStub },
        ],
      }).compileComponents();
      return TestBed.createComponent(DataEntryFormComponent);
    }

    it('pre-fills the Station from the project default on init in create mode', async () => {
      const f = await setupWith(project);
      f.detectChanges();
      expect(f.componentInstance.entryForm.get('ringing_station')!.value).toEqual(station);
    });

    it('leaves the Station empty when the project has no default', async () => {
      const f = await setupWith({ ...project, default_station: null });
      f.detectChanges();
      expect(f.componentInstance.entryForm.get('ringing_station')!.value).toBeNull();
    });
  });

  describe('recapture history table (Bisherige Fänge)', () => {
    it('shows the recapture column set with Alter/Geschlecht, dropping Station/Fett/Muskel', () => {
      expect(component.displayedHistoryColumns).toEqual([
        'date_time',
        'species',
        'bird_status',
        'staff',
        'tarsus',
        'feather_span',
        'wing_span',
        'weight_gram',
        'age_class',
        'sex',
        'actions',
      ]);
      expect(component.displayedHistoryColumns).not.toContain('ringing_station');
      expect(component.displayedHistoryColumns).not.toContain('fat_deposit');
      expect(component.displayedHistoryColumns).not.toContain('muscle_class');
    });

    it('shows Alter and Geschlecht headers, dropping Fett and Muskel', () => {
      component.recaptureHistory.set([
        {
          date_time: '2024-05-01T08:30:00Z',
          species: { common_name_de: 'Kohlmeise' },
          bird_status: BirdStatus.ReCatch,
          staff: { full_name: 'Filip Reiter', handle: 'FRE' },
          age_class: AgeClass.ThisYear,
          sex: Sex.Male,
        } as unknown as DataEntry,
      ]);
      fixture.detectChanges();

      const headers = Array.from(
        fixture.nativeElement.querySelectorAll('th[mat-header-cell]'),
      ).map((th) => (th as HTMLElement).textContent!.trim());
      expect(headers).toContain('Alter');
      expect(headers).toContain('Geschlecht');
      expect(headers).not.toContain('Fett');
      expect(headers).not.toContain('Muskel');
    });

    it('renders Alter and Geschlecht as readable labels, never the raw code', () => {
      component.recaptureHistory.set([
        {
          date_time: '2024-05-01T08:30:00Z',
          species: { common_name_de: 'Kohlmeise' },
          bird_status: BirdStatus.ReCatch,
          staff: { full_name: 'Filip Reiter', handle: 'FRE' },
          age_class: AgeClass.ThisYear,
          sex: Sex.Male,
        } as unknown as DataEntry,
      ]);
      fixture.detectChanges();

      const cellText = (column: string) =>
        (
          fixture.nativeElement.querySelector(`td.mat-column-${column}`) as HTMLElement
        ).textContent!.trim();
      expect(cellText('age_class')).toContain('Diesjährig');
      expect(cellText('sex')).toContain('Männlich');
    });

    const historyRow = (overrides: Partial<DataEntry>): DataEntry =>
      ({
        date_time: '2024-05-01T08:30:00Z',
        species: { common_name_de: 'Kohlmeise' },
        bird_status: BirdStatus.ReCatch,
        staff: { full_name: 'Filip Reiter', handle: 'FRE' },
        age_class: AgeClass.Unknown,
        sex: Sex.Unknown,
        ...overrides,
      }) as unknown as DataEntry;

    const contradictionFlag = () =>
      fixture.nativeElement.querySelector('.sex-contradiction') as HTMLElement | null;

    it('flags a determined Männchen ↔ Weibchen contradiction across the history', () => {
      component.recaptureHistory.set([
        historyRow({ sex: Sex.Male }),
        historyRow({ sex: Sex.Female }),
      ]);
      fixture.detectChanges();

      expect(contradictionFlag()).not.toBeNull();
    });

    it('does not flag when only the age class differs but the sexes agree', () => {
      component.recaptureHistory.set([
        historyRow({ sex: Sex.Female, age_class: AgeClass.ThisYear }),
        historyRow({ sex: Sex.Female, age_class: AgeClass.NotThisYear }),
      ]);
      fixture.detectChanges();

      expect(contradictionFlag()).toBeNull();
    });

    it('does not flag an Unbekannt → determined progression', () => {
      component.recaptureHistory.set([
        historyRow({ sex: Sex.Unknown }),
        historyRow({ sex: Sex.Male }),
      ]);
      fixture.detectChanges();

      expect(contradictionFlag()).toBeNull();
    });

    it('does not flag a single determined sex repeated across catches', () => {
      component.recaptureHistory.set([
        historyRow({ sex: Sex.Male }),
        historyRow({ sex: Sex.Male }),
      ]);
      fixture.detectChanges();

      expect(contradictionFlag()).toBeNull();
    });

    it('renders Beringer (Kürzel), Tarsus and Federlänge for a Wiederfang row', () => {
      component.recaptureHistory.set([
        {
          date_time: '2024-05-01T08:30:00Z',
          species: { common_name_de: 'Kohlmeise' },
          bird_status: BirdStatus.ReCatch,
          staff: { full_name: 'Filip Reiter', handle: 'FRE' },
          tarsus: 19,
          feather_span: 54,
          wing_span: 73,
          weight_gram: 18,
        } as unknown as DataEntry,
      ]);
      fixture.detectChanges();

      const headers = Array.from(
        fixture.nativeElement.querySelectorAll('th[mat-header-cell]'),
      ).map((th) => (th as HTMLElement).textContent!.trim());
      expect(headers).not.toContain('Station');
      expect(headers).toContain('Beringer');
      expect(headers).toContain('Tarsus (mm)');
      expect(headers).toContain('Federlänge (mm)');

      const cellText = (column: string) =>
        (
          fixture.nativeElement.querySelector(`td.mat-column-${column}`) as HTMLElement
        ).textContent!.trim();
      // The recapture table shows the Kürzel/handle to make room, not the full name.
      expect(cellText('staff')).toBe('FRE');
      expect(cellText('tarsus')).toBe('19,0');
      expect(cellText('feather_span')).toBe('54,0');
      expect(fixture.nativeElement.querySelector('td.mat-column-ringing_station')).toBeNull();
    });

    it('formats biometric values with one decimal place in de-AT format', () => {
      component.recaptureHistory.set([
        {
          date_time: '2024-05-01T08:30:00Z',
          species: { common_name_de: 'Kohlmeise' },
          bird_status: BirdStatus.ReCatch,
          staff: { full_name: 'Filip Reiter', handle: 'FRE' },
          tarsus: 12.54,
          feather_span: 54,
          wing_span: 73.25,
          weight_gram: 18.96,
        } as unknown as DataEntry,
      ]);
      fixture.detectChanges();

      const cellText = (column: string) =>
        (
          fixture.nativeElement.querySelector(`td.mat-column-${column}`) as HTMLElement
        ).textContent!.trim();
      // One decimal place, rounded, Austrian comma — display only.
      expect(cellText('tarsus')).toBe('12,5');
      expect(cellText('feather_span')).toBe('54,0');
      expect(cellText('wing_span')).toBe('73,3');
      expect(cellText('weight_gram')).toBe('19,0');
    });
  });

  describe('Ring Vernichtet sentinel (collapsing the form)', () => {
    const sentinel: Species = {
      id: 'sent',
      common_name_de: 'Ring Vernichtet',
      common_name_en: '',
      scientific_name: '',
      family_name: '',
      order_name: '',
      ring_size: null,
      special_kind: 'ring_destroyed',
    };

    function selectSpecies(species: Species) {
      component.onSpeciesSelected({ option: { value: species } } as MatAutocompleteSelectedEvent);
      fixture.detectChanges();
    }

    const has = (selector: string) =>
      fixture.nativeElement.querySelector(selector) !== null;

    it('hides the bird fields and keeps only Ringgröße/Ringnummer/Bemerkung when a sentinel Art is selected', () => {
      expect(has('[formControlName="age_class"]')).toBe(true);

      selectSpecies(sentinel);

      expect(component.isRingDestroyed()).toBe(true);
      expect(has('[formControlName="age_class"]')).toBe(false);
      expect(has('[formControlName="sex"]')).toBe(false);
      expect(has('[formControlName="bird_status"]')).toBe(false);
      expect(has('[formControlName="tarsus"]')).toBe(false);
      // The essentials stay.
      expect(has('[formControlName="ring_size"]')).toBe(true);
      expect(has('[formControlName="ring_number"]')).toBe(true);
      expect(has('[formControlName="comment"]')).toBe(true);
    });

    it('relaxes the bird-field validators so a sentinel record is submittable with only the essentials', () => {
      const form = component.entryForm;
      form.patchValue({
        ringing_station: { handle: 'STAMT', name: 'Linz' } as never,
        staff: { id: 'p1', handle: 'FRE', full_name: 'Filip Reiter' } as never,
        species: sentinel as never,
        ring_size: RingSize.S,
        ring_number: '901234',
        bird_status: null,
      });

      // Normal mode: bird_status is required, so the form is invalid.
      expect(form.valid).toBe(false);

      selectSpecies(sentinel);

      expect(form.valid).toBe(true);
    });

    it('keeps the bird fields visible when a normal Art is selected', () => {
      const normal: Species = { ...sentinel, id: 's1', common_name_de: 'Kohlmeise', special_kind: '' };

      selectSpecies(normal);

      expect(component.isRingDestroyed()).toBe(false);
      expect(has('[formControlName="age_class"]')).toBe(true);
      expect(has('[formControlName="bird_status"]')).toBe(true);
    });
  });

  describe('Aves ignota unknown_species (full form, mandatory Bemerkung) (#57)', () => {
    const avesIgnota: Species = {
      id: 'aves',
      common_name_de: 'Art nicht in der Liste (Aves ignota)',
      common_name_en: 'Species not listed',
      scientific_name: 'Aves ignota',
      family_name: '—',
      order_name: '—',
      ring_size: null,
      special_kind: 'unknown_species',
    };

    function selectSpecies(species: Species) {
      component.onSpeciesSelected({ option: { value: species } } as MatAutocompleteSelectedEvent);
      fixture.detectChanges();
    }

    const has = (selector: string) => fixture.nativeElement.querySelector(selector) !== null;

    it('keeps the full measurement form (does not collapse) when Aves ignota is selected', () => {
      selectSpecies(avesIgnota);

      expect(component.isUnknownSpecies()).toBe(true);
      expect(component.isRingDestroyed()).toBe(false);
      // Unlike a destroyed ring, every bird field stays in the form.
      expect(has('[formControlName="age_class"]')).toBe(true);
      expect(has('[formControlName="sex"]')).toBe(true);
      expect(has('[formControlName="bird_status"]')).toBe(true);
      expect(has('[formControlName="tarsus"]')).toBe(true);
    });

    it('makes the Bemerkung required while Aves ignota is selected', () => {
      const comment = component.entryForm.get('comment')!;
      // A normal taxon leaves the comment optional.
      expect(comment.hasError('required')).toBe(false);

      selectSpecies(avesIgnota);

      expect(comment.hasError('required')).toBe(true);

      comment.setValue('Seltener Irrgast.');
      expect(comment.hasError('required')).toBe(false);
    });

    it('releases the required Bemerkung again when a normal Art is selected next', () => {
      selectSpecies(avesIgnota);
      const normal: Species = { ...avesIgnota, id: 's1', common_name_de: 'Kohlmeise', special_kind: '' };

      selectSpecies(normal);

      expect(component.isUnknownSpecies()).toBe(false);
      expect(component.entryForm.get('comment')!.hasError('required')).toBe(false);
    });

    it('shows an inline field error for the empty mandatory Bemerkung', () => {
      selectSpecies(avesIgnota);
      const comment = component.entryForm.get('comment')!;
      comment.markAsTouched();
      fixture.detectChanges();

      const error = fixture.nativeElement.querySelector('mat-error');
      expect(error).not.toBeNull();
      expect(error.textContent).toContain('Aves ignota');
    });
  });

  describe('Schnell-Button "Ring vernichtet" (quick-button with confirmation)', () => {
    const sentinel: Species = {
      id: 'sent',
      common_name_de: 'Ring Vernichtet',
      common_name_en: '',
      scientific_name: '',
      family_name: '',
      order_name: '',
      ring_size: null,
      special_kind: 'ring_destroyed',
    };
    const project = {
      id: 'p1',
      title: 'Herbst',
      description: '',
      show_optional_fields: true,
      organization: { id: 'o1', handle: 'IWM', name: 'IWM Linz', country: 'AT' },
      default_station: null,
      scientists: [],
      created: '',
      updated: '',
    } as Project;
    const dialogMock = { open: jasmine.createSpy('open') };
    let httpMock: HttpTestingController;

    beforeEach(async () => {
      TestBed.resetTestingModule();
      dialogMock.open.calls.reset();
      await TestBed.configureTestingModule({
        imports: [DataEntryFormComponent],
        providers: [
          provideRouter([]),
          provideHttpClient(),
          provideHttpClientTesting(),
          provideNoopAnimations(),
          {
            provide: ProjectService,
            useValue: { currentProject: signal<Project | null>(project), setCurrent: () => {}, clear: () => {} },
          },
        ],
      })
        .overrideComponent(DataEntryFormComponent, {
          add: { providers: [{ provide: MatDialog, useValue: dialogMock }] },
        })
        .compileComponents();

      fixture = TestBed.createComponent(DataEntryFormComponent);
      component = fixture.componentInstance;
      httpMock = TestBed.inject(HttpTestingController);
      fixture.detectChanges();
      // The component fetches the sentinel Art once on init.
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/species/'))
        .flush({ count: 1, next: null, previous: null, results: [sentinel] });
    });

    it('opens a confirmation modal and sets the sentinel Art when confirmed', () => {
      dialogMock.open.and.returnValue({ afterClosed: () => of(true) });

      component.onDestroyedRing();

      expect(dialogMock.open).toHaveBeenCalled();
      expect(component.entryForm.get('species')!.value).toEqual(sentinel);
      expect(component.isRingDestroyed()).toBe(true);
    });

    it('leaves the form untouched when the confirmation is cancelled', () => {
      dialogMock.open.and.returnValue({ afterClosed: () => of(false) });

      component.onDestroyedRing();

      expect(dialogMock.open).toHaveBeenCalled();
      expect(component.isRingDestroyed()).toBe(false);
      expect(component.entryForm.get('species')!.value).not.toEqual(sentinel);
    });

    it('renders a discreet quick-button inside the action row that triggers the flow', () => {
      const button: HTMLButtonElement | null = fixture.nativeElement.querySelector(
        '.action-buttons button[data-testid="destroyed-ring-button"]',
      );
      expect(button).not.toBeNull();

      const spy = spyOn(component, 'onDestroyedRing');
      button!.click();
      expect(spy).toHaveBeenCalled();
    });

    it('positions "Ring vernichtet" opposite (left of) Zurücksetzen and Erstellen', () => {
      const labels = Array.from(
        fixture.nativeElement.querySelectorAll('.action-buttons button'),
      ).map((b) => (b as HTMLElement).textContent!.trim());

      const destroyedIdx = labels.findIndex((l) => l === 'Ring vernichtet');
      const resetIdx = labels.indexOf('Zurücksetzen');
      const createIdx = labels.indexOf('Erstellen');

      expect(destroyedIdx).toBeGreaterThanOrEqual(0);
      expect(destroyedIdx).toBeLessThan(resetIdx);
      expect(destroyedIdx).toBeLessThan(createIdx);
    });
  });

  describe('edit mode (opening an existing entry via /data-entry/:id)', () => {
    const station: RingingStation = {
      handle: 'STAMT',
      name: 'Linz, Botanischer Garten',
      organization: { id: 'o1', handle: 'IWM', name: 'IWM Linz', country: 'AT' },
    };

    function savedEntry(): DataEntry {
      return {
        id: '42',
        species: {
          id: 's1',
          common_name_de: 'Kohlmeise',
          scientific_name: 'Parus major',
          ring_size: RingSize.S,
        },
        ring: { id: 'r1', number: '901234', size: RingSize.S },
        staff: { id: 'p1', handle: 'FRE', full_name: 'Filip Reiter' },
        ringing_station: station,
        project: null,
        net_location: 3,
        net_height: 2,
        net_direction: null,
        feather_span: 54,
        wing_span: 73,
        tarsus: 19,
        notch_f2: null,
        inner_foot: null,
        weight_gram: 18,
        bird_status: BirdStatus.ReCatch,
        fat_deposit: null,
        muscle_class: null,
        age_class: AgeClass.ThisYear,
        sex: Sex.Female,
        small_feather_int: null,
        small_feather_app: null,
        hand_wing: null,
        date_time: '2024-05-01T08:30:00Z',
        created: '2024-05-01T08:30:00Z',
        updated: '2024-05-01T08:30:00Z',
        comment: 'Wiederfang am Hauptnetz',
        has_mites: false,
        has_hunger_stripes: false,
        has_brood_patch: false,
        has_cpl_plus: false,
      } as unknown as DataEntry;
    }

    async function setupEditMode(entryId: string) {
      const routeStub = {
        snapshot: { paramMap: { get: (key: string) => (key === 'id' ? entryId : null) } },
      };
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [DataEntryFormComponent],
        providers: [
          provideRouter([]),
          provideHttpClient(),
          provideHttpClientTesting(),
          provideNoopAnimations(),
          { provide: ActivatedRoute, useValue: routeStub },
        ],
      }).compileComponents();
      const f = TestBed.createComponent(DataEntryFormComponent);
      const httpMock = TestBed.inject(HttpTestingController);
      return { f, httpMock };
    }

    it('fetches the entry and pre-fills the form with its saved values', async () => {
      const { f, httpMock } = await setupEditMode('42');
      f.detectChanges();

      const req = httpMock.expectOne(
        (r) => r.method === 'GET' && r.url.endsWith('/birds/data-entries/42/'),
      );
      req.flush(savedEntry());

      const form = f.componentInstance.entryForm;
      expect(f.componentInstance.isEditMode()).toBe(true);
      expect(form.get('species')!.value).toEqual(savedEntry().species);
      expect(form.get('ring_size')!.value).toBe(RingSize.S);
      expect(form.get('ring_number')!.value).toBe('901234');
      expect(form.get('bird_status')!.value).toBe(BirdStatus.ReCatch);
      expect(form.get('comment')!.value).toBe('Wiederfang am Hauptnetz');
    });

    it('saves an edit via PUT, then returns to the list without clearing the form', async () => {
      const { f, httpMock } = await setupEditMode('42');
      f.detectChanges();
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/data-entries/42/'))
        .flush(savedEntry());

      const router = TestBed.inject(Router);
      const navigateSpy = spyOn(router, 'navigateByUrl').and.resolveTo(true);

      f.componentInstance.onSubmit();

      const putReq = httpMock.expectOne(
        (r) => r.method === 'PUT' && r.url.endsWith('/birds/data-entries/42/'),
      );
      putReq.flush(savedEntry());

      expect(navigateSpy).toHaveBeenCalledWith('/data-entries');
      // No clearForm() on edit: the loaded values must survive the save.
      expect(f.componentInstance.entryForm.get('species')!.value).toEqual(savedEntry().species);
      expect(f.componentInstance.entryForm.get('ring_number')!.value).toBe('901234');
    });

    it('never sends idempotency_key on an edit (#155): editing must not touch the create key', async () => {
      const { f, httpMock } = await setupEditMode('42');
      f.detectChanges();
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/data-entries/42/'))
        .flush(savedEntry());

      f.componentInstance.onSubmit();

      const putReq = httpMock.expectOne(
        (r) => r.method === 'PUT' && r.url.endsWith('/birds/data-entries/42/'),
      );
      expect(putReq.request.body.idempotency_key).toBeUndefined();
      putReq.flush(savedEntry());
    });

    it('lets Enter on the focused "Zur Liste" button activate it (#59, not suppressed)', async () => {
      const { f, httpMock } = await setupEditMode('42');
      f.detectChanges();
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/data-entries/42/'))
        .flush(savedEntry());
      f.detectChanges();

      const backToList = Array.from(
        f.nativeElement.querySelectorAll('.action-buttons button'),
      ).find((b) => (b as HTMLElement).textContent!.trim() === 'Zur Liste') as HTMLButtonElement;
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });

      backToList.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
    });

    it('collapses the form when the loaded entry is a sentinel "Ring Vernichtet"', async () => {
      const { f, httpMock } = await setupEditMode('43');
      f.detectChanges();

      const sentinelEntry = {
        ...savedEntry(),
        id: '43',
        species: { id: 'sent', common_name_de: 'Ring Vernichtet', scientific_name: '', special_kind: 'ring_destroyed' },
        bird_status: null,
        age_class: null,
        sex: null,
      } as unknown as DataEntry;
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/data-entries/43/'))
        .flush(sentinelEntry);
      f.detectChanges();

      expect(f.componentInstance.isRingDestroyed()).toBe(true);
      expect(f.nativeElement.querySelector('[formControlName="age_class"]')).toBeNull();
    });

    it('restores the saved values (not an empty form) when Zurücksetzen is confirmed (#24)', async () => {
      const { f, httpMock } = await setupEditMode('42');
      f.detectChanges();
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/data-entries/42/'))
        .flush(savedEntry());

      const component = f.componentInstance;
      const form = component.entryForm;
      // The user edits the record, then changes their mind.
      form.get('comment')!.setValue('etwas anderes');
      form.get('weight_gram')!.setValue(99);
      form.markAsDirty();
      spyOn((component as unknown as { dialog: MatDialog }).dialog, 'open').and.returnValue({
        afterClosed: () => of(true),
      } as never);

      component.onReset();

      // Restored to the saved record, not emptied.
      expect(form.get('comment')!.value).toBe('Wiederfang am Hauptnetz');
      expect(form.get('weight_gram')!.value).toBe(18);
      expect(form.get('species')!.value).toEqual(savedEntry().species);
      expect(form.get('ring_number')!.value).toBe('901234');
      expect(form.pristine).toBe(true);
    });

    it('keeps a separate navigation back to the list in edit mode (#24)', async () => {
      const { f, httpMock } = await setupEditMode('42');
      f.detectChanges();
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/data-entries/42/'))
        .flush(savedEntry());
      f.detectChanges();

      const backButton = Array.from(
        f.nativeElement.querySelectorAll('.action-buttons button'),
      ).find((b) => (b as HTMLElement).textContent!.trim() === 'Zur Liste') as
        | HTMLButtonElement
        | undefined;
      expect(backButton).toBeTruthy();

      const router = TestBed.inject(Router);
      const navigateSpy = spyOn(router, 'navigateByUrl').and.resolveTo(true);
      f.componentInstance.onBackToList();
      expect(navigateSpy).toHaveBeenCalledWith('/data-entries');
    });
  });

  describe('queued edit mode (opening a queued outbox entry via /data-entry/:id) (issue #163)', () => {
    const station: RingingStation = {
      handle: 'STAMT',
      name: 'Linz, Botanischer Garten',
      organization: { id: 'o1', handle: 'IWM', name: 'IWM Linz', country: 'AT' },
    };
    const species: Species = {
      id: 's1',
      common_name_de: 'Kohlmeise',
      common_name_en: 'Great Tit',
      scientific_name: 'Parus major',
      family_name: '',
      order_name: '',
      ring_size: RingSize.V,
      special_kind: '',
    };
    const staff: Scientist = { id: 'sci-1', handle: 'FRE', full_name: 'Filip Reiter' };

    function queuedPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        ringing_station_id: 'STAMT',
        staff_id: 'sci-1',
        date_time: '2026-07-02T09:00',
        species_id: 's1',
        bird_status: BirdStatus.FirstCatch,
        ring_size: RingSize.V,
        ring_number: '0043',
        net_location: null,
        net_height: null,
        net_direction: null,
        fat_deposit: null,
        muscle_class: null,
        age_class: AgeClass.Unknown,
        sex: Sex.Unknown,
        small_feather_int: null,
        small_feather_app: null,
        hand_wing: null,
        tarsus: null,
        feather_span: null,
        wing_span: null,
        weight_gram: 18,
        notch_f2: null,
        inner_foot: null,
        comment: 'Erste Notiz',
        has_mites: false,
        has_hunger_stripes: false,
        has_brood_patch: false,
        has_cpl_plus: false,
        idempotency_key: 'outbox-uuid-1',
        project_id: 'p1',
        ...overrides,
      };
    }

    async function setupQueuedEditMode(
      outboxId: string,
      payload: Record<string, unknown>,
    ): Promise<{ f: ComponentFixture<DataEntryFormComponent>; httpMock: HttpTestingController }> {
      const routeStub = {
        snapshot: { paramMap: { get: (key: string) => (key === 'id' ? outboxId : null) } },
      };
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [DataEntryFormComponent],
        providers: [
          provideRouter([]),
          provideHttpClient(),
          provideHttpClientTesting(),
          provideNoopAnimations(),
          { provide: ActivatedRoute, useValue: routeStub },
        ],
      }).compileComponents();

      TestBed.inject(AuthService).currentUser.set({
        username: 'fre',
        handle: 'FRE',
        isStaff: false,
        rolle: 'mitglied',
        organization: null,
      });
      await TestBed.inject(OutboxStoreService).add({
        id: outboxId,
        accountKey: 'fre',
        payload,
        queuedAt: '2026-07-02T09:00:00.000Z',
      });
      // The outbox must have finished restoring before the component is
      // constructed — see the `entryId` effect's comment on why the
      // resolution check is deliberately synchronous.
      await TestBed.inject(OutboxService).ready;

      await TestBed.inject(ReferenceBundleCacheService).save({
        bundle: {
          identity: { username: 'fre', handle: 'FRE', organization: null, rolle: 'mitglied' },
          species: [{ ...species, usage_count: 0 }],
          ringing_stations: [station],
          scientists: [staff],
          projects: [],
          centrals: [],
          last_consumed_ring_numbers: [],
        },
        refreshedAt: '2026-07-02T08:00:00.000Z',
      });

      const f = TestBed.createComponent(DataEntryFormComponent);
      const httpMock = TestBed.inject(HttpTestingController);
      return { f, httpMock };
    }

    afterEach(async () => {
      await TestBed.inject(OutboxStoreService).remove('outbox-uuid-1');
      await TestBed.inject(ReferenceBundleCacheService).clear();
      // This describe block uses the real (unstubbed) ProjectService, and a
      // couple of tests call `.setCurrent()` on it, which persists to real
      // `localStorage` — clear it so a later test's fresh ProjectService
      // instance (new TestBed module) never starts from a leaked Projekt.
      TestBed.inject(ProjectService).clear();
    });

    // The queued-entry resolution writes through to the real (unpatched by
    // Zone) browser IndexedDB, so neither `fixture.whenStable()` nor a plain
    // microtask await observes its completion — only real elapsed time does
    // (same pattern as offline-readiness.spec.ts).
    function settle(): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, 20));
    }

    it('resolves the queued entry locally (never hits the server) and pre-fills the form from the cached bundle', async () => {
      const { f, httpMock } = await setupQueuedEditMode('outbox-uuid-1', queuedPayload());
      f.detectChanges();

      httpMock.expectNone(
        (r) => r.method === 'GET' && r.url.endsWith('/birds/data-entries/outbox-uuid-1/'),
      );

      await settle();
      f.detectChanges();

      const form = f.componentInstance.entryForm;
      expect(f.componentInstance.isEditMode()).toBe(true);
      expect(f.componentInstance.isQueuedEditMode()).toBe(true);
      expect(form.get('species')!.value).toEqual(jasmine.objectContaining(species));
      expect(form.get('ringing_station')!.value).toEqual(station);
      expect(form.get('staff')!.value).toEqual(staff);
      expect(form.get('ring_number')!.value).toBe('0043');
      expect(form.get('comment')!.value).toBe('Erste Notiz');
    });

    it('re-queues the edit into the outbox on submit instead of PUTting to the server', async () => {
      const { f, httpMock } = await setupQueuedEditMode('outbox-uuid-1', queuedPayload());
      f.detectChanges();
      await settle();
      f.detectChanges();

      f.componentInstance.entryForm.get('weight_gram')!.setValue(21);
      f.componentInstance.onSubmit();
      await settle();

      httpMock.expectNone(
        (r) => r.method === 'PUT' && r.url.endsWith('/birds/data-entries/outbox-uuid-1/'),
      );
      httpMock.expectNone((r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'));

      const stored = await TestBed.inject(OutboxStoreService).listForAccount('fre');
      expect(stored.length).toBe(1);
      expect(stored[0].id).toBe('outbox-uuid-1');
      expect(stored[0].queuedAt).toBe('2026-07-02T09:00:00.000Z');
      expect(stored[0].payload['weight_gram']).toBe(21);
      expect(stored[0].payload['idempotency_key']).toBe('outbox-uuid-1');
    });

    it('navigates back to "today\'s session" (not the synced-only list) after re-queueing', async () => {
      const { f } = await setupQueuedEditMode('outbox-uuid-1', queuedPayload());
      f.detectChanges();
      await settle();
      f.detectChanges();

      const router = TestBed.inject(Router);
      const navigateSpy = spyOn(router, 'navigateByUrl').and.resolveTo(true);

      f.componentInstance.onSubmit();
      await settle();

      expect(navigateSpy).toHaveBeenCalledWith('/heute');
    });

    it('keeps the entry\'s original project_id when the active Projekt has changed since queuing (review fix)', async () => {
      // Queued under Projekt "p1" (queuedPayload()'s default). Reproduces the
      // review scenario: a Mitglied assigned to two Projekte queues a capture
      // under Projekt A, later switches the active Projekt to B via the
      // ordinary picker (ProjectService.setCurrent()), then opens the still
      // queued entry and fixes a typo.
      const { f } = await setupQueuedEditMode('outbox-uuid-1', queuedPayload({ project_id: 'p1' }));
      f.detectChanges();
      await settle();
      f.detectChanges();

      TestBed.inject(ProjectService).setCurrent({
        ...createProject(),
        id: 'p2',
        title: 'Frühjahr',
      } as Project);

      f.componentInstance.entryForm.get('comment')!.setValue('Tippfehler korrigiert');
      f.componentInstance.onSubmit();
      await settle();

      const stored = await TestBed.inject(OutboxStoreService).listForAccount('fre');
      expect(stored.length).toBe(1);
      expect(stored[0].payload['project_id']).toBe('p1');
    });

    it('keeps project_id absent when the entry was originally queued without an active Projekt (review fix)', async () => {
      const payload = queuedPayload();
      delete payload['project_id'];
      const { f } = await setupQueuedEditMode('outbox-uuid-1', payload);
      f.detectChanges();
      await settle();
      f.detectChanges();

      // An active Projekt now, at edit time — must still not be written onto
      // an entry that never had one.
      TestBed.inject(ProjectService).setCurrent(createProject());

      f.componentInstance.entryForm.get('comment')!.setValue('Tippfehler korrigiert');
      f.componentInstance.onSubmit();
      await settle();

      const stored = await TestBed.inject(OutboxStoreService).listForAccount('fre');
      expect(stored.length).toBe(1);
      expect(stored[0].payload['project_id']).toBeUndefined();
    });

    // #232/#163, US 13: the outbox carries a foreign Zentrale only as its bare
    // scheme code. Reopening the queued entry must rebuild it into a Central
    // object so the capture reopens in free-text mode, the stored foreign
    // Ringgröße survives, and re-save is not blocked by an unmatchedOption.
    it('reopens a queued foreign recapture in free-text mode with the Zentrale rebuilt from its scheme code', async () => {
      const { f } = await setupQueuedEditMode(
        'outbox-uuid-1',
        queuedPayload({
          bird_status: BirdStatus.ReCatch,
          central: 'SKB',
          ring_size: 'SA',
          ring_number: 'AB1234',
        }),
      );
      f.detectChanges();
      await settle();
      f.detectChanges();

      const form = f.componentInstance.entryForm;
      // The bare scheme-code string is resolved back to a Central object.
      expect(f.componentInstance.isForeignCentral()).toBe(true);
      expect((form.get('central')!.value as Central).scheme_code).toBe('SKB');
      // The stored foreign Ringgröße survives the ring-size effect (not wiped as
      // a non-Austrian value) and the free-text field — not the strict dropdown
      // — is shown.
      expect(form.get('ring_size')!.value as unknown as string).toBe('SA');
      expect(f.nativeElement.querySelector('[data-testid="ring-size-freetext"]')).not.toBeNull();
      expect(f.nativeElement.querySelector('[data-testid="ring-size-dropdown"]')).toBeNull();
      // The Zentrale carries no unmatchedOption error that would block re-save.
      expect(form.get('central')!.hasError('unmatchedOption')).toBe(false);
    });

    it('re-queues a foreign recapture edit with the Zentrale scheme code preserved', async () => {
      const { f } = await setupQueuedEditMode(
        'outbox-uuid-1',
        queuedPayload({
          bird_status: BirdStatus.ReCatch,
          central: 'SKB',
          ring_size: 'SA',
          ring_number: 'AB1234',
        }),
      );
      f.detectChanges();
      await settle();
      f.detectChanges();

      f.componentInstance.entryForm.get('comment')!.setValue('Tippfehler korrigiert');
      f.componentInstance.onSubmit();
      await settle();

      const stored = await TestBed.inject(OutboxStoreService).listForAccount('fre');
      expect(stored.length).toBe(1);
      expect(stored[0].payload['central']).toBe('SKB');
      expect(stored[0].payload['ring_size']).toBe('SA');
      expect(stored[0].payload['ring_number']).toBe('AB1234');
      expect(stored[0].payload['comment']).toBe('Tippfehler korrigiert');
    });
  });

  describe('auto-filling the next ring number (#42)', () => {
    let httpMock: HttpTestingController;

    beforeEach(async () => {
      httpMock = await setupCreateMode();
    });

    function selectFirstCatchSize(): void {
      component.entryForm.patchValue({
        bird_status: BirdStatus.FirstCatch,
        ring_size: RingSize.V,
      });
      fixture.detectChanges();
    }

    it('populates the Ringnummer with the suggestion verbatim, preserving leading zeros', () => {
      selectFirstCatchSize();

      const req = httpMock.expectOne(
        (r) => r.method === 'GET' && r.url.endsWith('/birds/rings/next-number/'),
      );
      expect(req.request.params.get('size')).toBe('V');
      req.flush({ next_number: '0043' });

      expect(component.entryForm.get('ring_number')!.value).toBe('0043');
    });

    it('leaves the Ringnummer empty when there is no suggestion (null)', () => {
      selectFirstCatchSize();

      const req = httpMock.expectOne(
        (r) => r.method === 'GET' && r.url.endsWith('/birds/rings/next-number/'),
      );
      req.flush({ next_number: null });

      expect(component.entryForm.get('ring_number')!.value).toBe('');
    });
  });

  describe('keyboard save shortcut (Strg+S / Cmd+S) (#23)', () => {
    let httpMock: HttpTestingController;

    afterEach(() => localStorage.clear());

    beforeEach(async () => {
      httpMock = await setupCreateMode();
    });

    function fillValidWiederfang(): void {
      component.entryForm.patchValue({
        ringing_station: { handle: 'STAMT', name: 'Linz' } as never,
        staff: { id: 'p1', handle: 'FRE', full_name: 'Filip Reiter' } as never,
        species: { id: 's1', common_name_de: 'Kohlmeise' } as never,
        bird_status: BirdStatus.ReCatch,
        ring_size: RingSize.S,
        ring_number: '901234',
      });
    }

    it('saves the new record (POST) and prevents the browser save-page dialog', () => {
      fillValidWiederfang();
      const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true });

      component.onKeydown(event);

      const post = httpMock.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'),
      );
      post.flush({});
      expect(event.defaultPrevented).toBe(true);
    });

    it('also saves on Cmd+S, but a bare "s" keystroke never saves', () => {
      const submitSpy = spyOn(component, 'onSubmit').and.callThrough();

      component.onKeydown(new KeyboardEvent('keydown', { key: 's', metaKey: true, cancelable: true }));
      expect(submitSpy).toHaveBeenCalledTimes(1);

      component.onKeydown(new KeyboardEvent('keydown', { key: 's', cancelable: true }));
      expect(submitSpy).toHaveBeenCalledTimes(1);
    });

    it('on an invalid form shows errors and focuses the first invalid field, without saving', () => {
      // A fresh create form is missing the required Station (first in focus order).
      expect(component.entryForm.valid).toBe(false);

      component.onKeydown(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true }));

      httpMock.expectNone((r) => r.method === 'POST');
      expect(component.entryForm.get('ringing_station')!.touched).toBe(true);
      const station = fixture.nativeElement.querySelector('[formControlName="ringing_station"]');
      expect(document.activeElement).toBe(station);
    });
  });

  describe('Enter dispatch (#23)', () => {
    let httpMock: HttpTestingController;

    afterEach(() => localStorage.clear());

    beforeEach(async () => {
      httpMock = await setupCreateMode();
    });

    const el = (name: string) =>
      fixture.nativeElement.querySelector(`[formControlName="${name}"]`) as HTMLElement;

    it('advances focus to the next field on Enter and suppresses the implicit submit', fakeAsync(() => {
      const netLocation = el('net_location');
      const netHeight = el('net_height');
      netLocation.focus();

      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      netLocation.dispatchEvent(event);
      tick(50);

      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(netHeight);
    }));

    it('lets Enter on the focused save button submit the form (native button activation)', () => {
      const saveButton = fixture.nativeElement.querySelector(
        'button[type="submit"]',
      ) as HTMLButtonElement;
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });

      saveButton.dispatchEvent(event);

      // Not suppressed: the native button activation (→ submit) is allowed to run.
      expect(event.defaultPrevented).toBe(false);
    });

    it('keeps Enter as a newline inside the Bemerkungen textarea', () => {
      const textarea = el('comment');
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });

      textarea.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
    });

    it('runs the ring-history search on Enter in the Ringnummer field during a Wiederfang', () => {
      component.entryForm.patchValue({
        bird_status: BirdStatus.ReCatch,
        ring_size: RingSize.S,
        ring_number: '901234',
      });
      fixture.detectChanges();

      const ringNumber = el('ring_number');
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      ringNumber.dispatchEvent(event);

      const search = httpMock.expectOne(
        (r) =>
          r.method === 'GET' &&
          r.url.endsWith('/birds/data-entries/') &&
          r.params.get('ring_number') === '901234',
      );
      search.flush({ count: 0, next: null, previous: null, results: [] });
      expect(event.defaultPrevented).toBe(true);
    });

    it('advances focus to the next field when an autocomplete option is accepted', fakeAsync(() => {
      const staff = el('staff'); // the field after ringing_station in focus order
      const selected = { option: { value: { handle: 'STAMT', name: 'Linz' } } } as never;

      component.onAutocompleteAccepted('ringing_station', selected);
      tick(50);

      expect(document.activeElement).toBe(staff);
    }));

    it('does not advance for the inline "neuer Beringer" option (null value)', fakeAsync(() => {
      const staffField = el('staff');
      staffField.focus();
      const createOption = { option: { value: null } } as never;

      component.onAutocompleteAccepted('staff', createOption);
      tick(50);

      // Focus stays put so the create-Beringer dialog flow is not disrupted.
      expect(document.activeElement).toBe(staffField);
    }));
  });

  describe('Enter activates focused action buttons (#59)', () => {
    afterEach(() => localStorage.clear());

    beforeEach(async () => {
      await setupCreateMode();
    });

    const actionButton = (label: string) =>
      (Array.from(fixture.nativeElement.querySelectorAll('.action-buttons button')).find(
        (b) => (b as HTMLElement).textContent!.trim() === label,
      ) as HTMLButtonElement) ?? null;

    it('lets Enter on the focused Zurücksetzen button activate it (not suppressed)', () => {
      const reset = actionButton('Zurücksetzen');
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });

      reset.dispatchEvent(event);

      // Not suppressed: native Enter activation of the button is allowed to run.
      expect(event.defaultPrevented).toBe(false);
    });

    it('lets Enter on the focused Ring vernichtet button activate it (not suppressed)', () => {
      const destroyed = actionButton('Ring vernichtet');
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });

      destroyed.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
    });

    it('lets Enter on the focused Ringhistorie search button activate it (not suppressed)', () => {
      // The Ringhistorie lookup button only appears during a Wiederfang and needs
      // both ring parts to be enabled.
      component.entryForm.patchValue({
        bird_status: BirdStatus.ReCatch,
        ring_size: RingSize.S,
        ring_number: '901234',
      });
      fixture.detectChanges();

      const search = fixture.nativeElement.querySelector(
        'button[aria-label="Ringhistorie suchen"]',
      ) as HTMLButtonElement;
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });

      search.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
    });

    it('still does not submit from a focused form field (Enter advances instead)', () => {
      const field = fixture.nativeElement.querySelector(
        '[formControlName="net_location"]',
      ) as HTMLElement;
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });

      field.dispatchEvent(event);

      // Broadening the button rule must not weaken the field rule: a field still
      // suppresses the implicit submit.
      expect(event.defaultPrevented).toBe(true);
    });
  });

  describe('recapture prefill from ring history (#23)', () => {
    let httpMock: HttpTestingController;

    afterEach(() => localStorage.clear());

    beforeEach(async () => {
      httpMock = await setupCreateMode();
    });

    function startWiederfangAndSearch(results: Partial<DataEntry>[]) {
      component.entryForm.patchValue({
        bird_status: BirdStatus.ReCatch,
        ring_size: RingSize.S,
        ring_number: '901234',
      });
      component.fetchRingHistory();
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/data-entries/'))
        .flush({ count: results.length, next: null, previous: null, results });
    }

    it('prefills Art and Geschlecht from the prior catch on a single match, leaving age and measurements empty', () => {
      const priorSpecies = { id: 's1', common_name_de: 'Kohlmeise' } as unknown as Species;
      startWiederfangAndSearch([
        {
          id: '9',
          species: priorSpecies,
          sex: Sex.Female,
          age_class: AgeClass.NotThisYear,
          tarsus: 19,
          wing_span: 73,
          weight_gram: 18,
          date_time: '2024-05-01T08:30:00Z',
        } as unknown as DataEntry,
      ]);

      expect(component.entryForm.get('species')!.value).toEqual(priorSpecies);
      expect(component.entryForm.get('sex')!.value).toBe(Sex.Female);
      // Age changes between catches and measurements are re-measured: never copied.
      expect(component.entryForm.get('age_class')!.value).toBe(AgeClass.Unknown);
      expect(component.entryForm.get('tarsus')!.value).toBeNull();
      expect(component.entryForm.get('wing_span')!.value).toBeNull();
      expect(component.entryForm.get('weight_gram')!.value).toBeNull();
    });

    it('takes Art and Geschlecht from the most recent catch when several exist', () => {
      const older = {
        id: '1',
        species: { id: 'old', common_name_de: 'Blaumeise' } as unknown as Species,
        sex: Sex.Male,
        date_time: '2020-01-01T00:00:00Z',
      } as unknown as DataEntry;
      const newer = {
        id: '2',
        species: { id: 'new', common_name_de: 'Kohlmeise' } as unknown as Species,
        sex: Sex.Female,
        date_time: '2024-05-01T08:30:00Z',
      } as unknown as DataEntry;

      // Deliberately out of order to prove selection is by date, not position.
      startWiederfangAndSearch([older, newer]);

      expect(component.entryForm.get('species')!.value).toEqual(newer.species);
      expect(component.entryForm.get('sex')!.value).toBe(Sex.Female);
    });

    it('leaves Art and Geschlecht empty and stays non-blocking when no prior catch is found', () => {
      startWiederfangAndSearch([]);

      expect(component.entryForm.get('species')!.value).toBeNull();
      expect(component.entryForm.get('sex')!.value).toBe(Sex.Unknown);
      expect(component.recaptureHistory()).toEqual([]);
    });
  });

  describe('local Wiederfang history panel offline (issue #168)', () => {
    const incompleteHint = () =>
      fixture.nativeElement.querySelector(
        '[data-testid="offline-history-incomplete"]',
      ) as HTMLElement | null;

    const historyRow = (): DataEntry =>
      ({
        id: 'outbox-uuid-1',
        date_time: '2026-07-01T08:30:00Z',
        species: { common_name_de: 'Kohlmeise' },
        ring: { id: '', number: '0043', size: RingSize.V },
        bird_status: BirdStatus.ReCatch,
        staff: { full_name: 'Filip Reiter', handle: 'FRE' },
        age_class: AgeClass.Unknown,
        sex: Sex.Unknown,
      }) as unknown as DataEntry;

    it('labels the history panel as possibly incomplete when it was assembled offline', () => {
      component.recaptureHistory.set([historyRow()]);
      component.historyPossiblyIncomplete.set(true);
      fixture.detectChanges();

      const hint = incompleteHint();
      expect(hint).not.toBeNull();
      expect(hint!.textContent).toContain('Offline');
      expect(hint!.textContent).toContain('möglicherweise unvollständig');
    });

    it('does not show the incomplete label when the history came from the server (online)', () => {
      component.recaptureHistory.set([historyRow()]);
      component.historyPossiblyIncomplete.set(false);
      fixture.detectChanges();

      expect(incompleteHint()).toBeNull();
    });

    it('routes the ring lookup through the offline-aware facade and shows the panel + label from a locally-assembled, possibly-incomplete history', () => {
      const facade = TestBed.inject(DataAccessFacadeService);
      const spy = spyOn(facade, 'getRingHistory').and.returnValue(
        of<RingHistory>({ entries: [historyRow()], possiblyIncomplete: true }),
      );

      component.entryForm.patchValue({
        bird_status: BirdStatus.ReCatch,
        ring_size: RingSize.V,
        ring_number: '0043',
      });
      component.fetchRingHistory();
      fixture.detectChanges();

      expect(spy).toHaveBeenCalledWith(RingSize.V, '0043');
      expect(component.historyPossiblyIncomplete()).toBeTrue();
      expect(component.recaptureHistory().length).toBe(1);
      expect(incompleteHint()).not.toBeNull();
    });

    it('shows the panel without the incomplete label when the facade returns a complete (online) history', () => {
      const facade = TestBed.inject(DataAccessFacadeService);
      spyOn(facade, 'getRingHistory').and.returnValue(
        of<RingHistory>({ entries: [historyRow()], possiblyIncomplete: false }),
      );

      component.entryForm.patchValue({
        bird_status: BirdStatus.ReCatch,
        ring_size: RingSize.V,
        ring_number: '0043',
      });
      component.fetchRingHistory();
      fixture.detectChanges();

      expect(component.historyPossiblyIncomplete()).toBeFalse();
      expect(component.recaptureHistory().length).toBe(1);
      expect(incompleteHint()).toBeNull();
    });
  });

  describe('conditional Kleingefieder Fortschritt (only for Diesjährig / Alter = 3) (#26)', () => {
    const intControl = () => component.entryForm.get('small_feather_int')!;
    const appControl = () => component.entryForm.get('small_feather_app')!;

    function setAge(age: AgeClass | null): void {
      component.entryForm.get('age_class')!.setValue(age as AgeClass);
      fixture.detectChanges();
    }

    it('enables the Intensität but disables the Fortschritt at the initial age class (not Diesjährig)', () => {
      // The form starts at AgeClass.Unknown (2). The Intensität is recorded for
      // every age class, so it is enabled from the start; only the Fortschritt
      // (post-juvenile moult progress) waits for a diesjährig age.
      expect(intControl().enabled).toBe(true);
      expect(appControl().disabled).toBe(true);
    });

    it('enables both Kleingefieder fields when the age class is Diesjährig (3)', () => {
      setAge(AgeClass.ThisYear);

      expect(intControl().enabled).toBe(true);
      expect(appControl().enabled).toBe(true);
    });

    it('clears and disables only the Fortschritt when the age class changes away from Diesjährig, keeping the Intensität and its value', () => {
      // Record Kleingefieder for a diesjähriger Vogel...
      setAge(AgeClass.ThisYear);
      intControl().setValue(SmallFeatherIntMoult.Many);
      appControl().setValue(SmallFeatherAppMoult.New);

      // ...then correct the age class to a non-diesjährig value.
      setAge(AgeClass.NotThisYear);

      // The Fortschritt is diesjährig-only: cleared + disabled. getRawValue() is
      // the export shape and includes disabled controls, so the cleared value
      // must hold there, not just in value.
      expect(appControl().disabled).toBe(true);
      // The Intensität is age-independent: it stays enabled and keeps its value.
      expect(intControl().enabled).toBe(true);
      expect(intControl().value).toBe(SmallFeatherIntMoult.Many);
      const raw = component.entryForm.getRawValue();
      expect(raw.small_feather_int).toBe(SmallFeatherIntMoult.Many);
      expect(raw.small_feather_app).toBeNull();
    });

    it('keeps a loaded Intensität value for a non-diesjährig bird (edit mode does not wipe it)', () => {
      // Simulate loading a saved record: a non-diesjährig bird with a recorded
      // Intensität. The age-class effect must not clear it on patch.
      component.entryForm.patchValue({
        age_class: AgeClass.NotThisYear,
        small_feather_int: SmallFeatherIntMoult.Some,
      });
      fixture.detectChanges();

      expect(intControl().enabled).toBe(true);
      expect(intControl().value).toBe(SmallFeatherIntMoult.Some);
      expect(appControl().disabled).toBe(true);
    });

    it('keeps the disabled Fortschritt visible in the layout (greyed out, not removed)', () => {
      setAge(AgeClass.NotThisYear);

      const el = (name: string) =>
        fixture.nativeElement.querySelector(`[formControlName="${name}"]`);
      expect(el('small_feather_int')).not.toBeNull();
      expect(el('small_feather_app')).not.toBeNull();
    });

    it('skips the disabled Fortschritt in the keyboard focus run, but stops on the enabled Intensität', fakeAsync(() => {
      // muscle_class → small_feather_int → (small_feather_app) → hand_wing.
      // With a non-diesjährig age class the Intensität is enabled (focus stops
      // there) and the Fortschritt is disabled (jumped over to hand_wing).
      setAge(AgeClass.NotThisYear);

      const el = (name: string) =>
        fixture.nativeElement.querySelector(`[formControlName="${name}"]`) as HTMLElement;
      const press = (from: HTMLElement) => {
        from.focus();
        from.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
        );
        tick(50);
      };

      press(el('muscle_class'));
      expect(document.activeElement).toBe(el('small_feather_int'));

      press(el('small_feather_int'));
      expect(document.activeElement).toBe(el('hand_wing'));
    }));
  });

  describe('Ringgröße selector — all 28 sizes (#25)', () => {
    it('offers all 28 Austrian ring sizes, ordered by inner diameter largest → smallest', () => {
      const expected = [
        'AS', 'BS', 'C', 'D', 'DS', 'DA', 'F', 'FA', 'G', 'GA', 'H', 'HA', 'K',
        'KA', 'L', 'LA', 'M', 'N', 'NA', 'P', 'PA', 'R', 'S', 'SA', 'T', 'TA',
        'V', 'X',
      ];
      expect(component.ringSizeOptions.map((o) => o.value)).toEqual(expected as never[]);
    });

    it('shows only the bare code as the label — no parenthesised description', () => {
      for (const option of component.ringSizeOptions) {
        expect(option.viewValue).toBe(option.value);
        expect(option.viewValue).not.toContain('(');
      }
    });

    it('drops the single-character ring-size shortcut so multi-letter codes work via type-ahead', () => {
      for (const option of component.ringSizeOptions) {
        expect(option.key).toBeUndefined();
      }
    });
  });

  describe('Ringgröße prefix before the Ringnummer (#25)', () => {
    const prefix = () =>
      fixture.nativeElement.querySelector(
        '[formControlName="ring_number"]',
      )?.closest('mat-form-field')?.querySelector('[matTextPrefix]') as HTMLElement | null;

    it('shows no size prefix while no Ringgröße is selected', () => {
      expect(prefix()?.textContent?.trim()).toBe('');
    });

    it('shows the selected size code as the prefix before the Ringnummer (e.g. V 1234)', () => {
      component.entryForm.get('ring_size')!.setValue(RingSize.V);
      fixture.detectChanges();

      expect(prefix()?.textContent?.trim()).toBe('V');
    });

    it('updates the prefix when the size changes to a multi-letter code', () => {
      component.entryForm.get('ring_size')!.setValue(RingSize.AS);
      fixture.detectChanges();

      expect(prefix()?.textContent?.trim()).toBe('AS');
    });
  });

  describe('off-recommendation Ringgröße confirmation modal (#25)', () => {
    const speciesWith = (ring_size: RingSize | null): Species => ({
      id: 's1',
      common_name_de: 'Kohlmeise',
      common_name_en: '',
      scientific_name: 'Parus major',
      family_name: '',
      order_name: '',
      ring_size,
      special_kind: '',
    });
    const project = {
      id: 'p1',
      title: 'Herbst',
      description: '',
      show_optional_fields: true,
      organization: { id: 'o1', handle: 'IWM', name: 'IWM Linz', country: 'AT' },
      default_station: null,
      scientists: [],
      created: '',
      updated: '',
    } as Project;
    const dialogMock = { open: jasmine.createSpy('open') };

    beforeEach(async () => {
      TestBed.resetTestingModule();
      dialogMock.open.calls.reset();
      dialogMock.open.and.returnValue({ afterClosed: () => of(true) });
      await TestBed.configureTestingModule({
        imports: [DataEntryFormComponent],
        providers: [
          provideRouter([]),
          provideHttpClient(),
          provideHttpClientTesting(),
          provideNoopAnimations(),
          {
            provide: ProjectService,
            useValue: { currentProject: signal<Project | null>(project), setCurrent: () => {}, clear: () => {} },
          },
        ],
      })
        .overrideComponent(DataEntryFormComponent, {
          add: { providers: [{ provide: MatDialog, useValue: dialogMock }] },
        })
        .compileComponents();

      fixture = TestBed.createComponent(DataEntryFormComponent);
      component = fixture.componentInstance;
      const httpMock = TestBed.inject(HttpTestingController);
      fixture.detectChanges();
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/species/'))
        .flush({ count: 0, next: null, previous: null, results: [] });
    });

    function selectSpecies(species: Species) {
      component.onSpeciesSelected({ option: { value: species } } as MatAutocompleteSelectedEvent);
    }

    it('opens a confirmation modal when the chosen size differs from an existing recommendation', () => {
      selectSpecies(speciesWith(RingSize.S)); // Empfohlene Ringgröße = S

      component.onRingSizeSelected({ value: RingSize.X } as never);

      expect(dialogMock.open).toHaveBeenCalled();
    });

    it('keeps the off-recommendation size when the modal is confirmed', () => {
      dialogMock.open.and.returnValue({ afterClosed: () => of(true) });
      selectSpecies(speciesWith(RingSize.S));

      component.entryForm.get('ring_size')!.setValue(RingSize.X);
      component.onRingSizeSelected({ value: RingSize.X } as never);

      expect(component.entryForm.get('ring_size')!.value).toBe(RingSize.X);
    });

    it('reverts to the recommended size when the modal is cancelled', () => {
      dialogMock.open.and.returnValue({ afterClosed: () => of(false) });
      selectSpecies(speciesWith(RingSize.S));

      component.entryForm.get('ring_size')!.setValue(RingSize.X);
      component.onRingSizeSelected({ value: RingSize.X } as never);

      expect(component.entryForm.get('ring_size')!.value).toBe(RingSize.S);
    });

    it('does not prompt when the species has no recommended ring size', () => {
      selectSpecies(speciesWith(null));

      component.onRingSizeSelected({ value: RingSize.X } as never);

      expect(dialogMock.open).not.toHaveBeenCalled();
    });

    it('does not prompt when the chosen size equals the recommendation', () => {
      selectSpecies(speciesWith(RingSize.S));

      component.onRingSizeSelected({ value: RingSize.S } as never);

      expect(dialogMock.open).not.toHaveBeenCalled();
    });
  });

  // #43: these specs drive the signal logic with synthetic events. The real
  // OS-level Caps-Lock on/off-and-clear behavior is NOT asserted here — Karma
  // mocks getModifierState and cannot toggle the physical key — and is verified
  // manually in a real browser instead (see PR notes), not via a stand-in test.
  describe('CapsLock indicator (#23, #43)', () => {
    function keyEvent(capsLockOn: boolean): KeyboardEvent {
      return {
        key: 'a',
        getModifierState: (modifier: string) => modifier === 'CapsLock' && capsLockOn,
        preventDefault: () => {},
      } as unknown as KeyboardEvent;
    }

    const hint = () =>
      fixture.nativeElement.querySelector('[data-testid="capslock-hint"]') as HTMLElement | null;

    it('shows a hint while CapsLock is active and hides it when released', () => {
      expect(hint()).toBeNull();

      component.onKeydown(keyEvent(true));
      fixture.detectChanges();
      expect(hint()).not.toBeNull();

      component.onKeyup(keyEvent(false));
      fixture.detectChanges();
      expect(hint()).toBeNull();
    });

    it('toggles the warning across on→off→on as the CapsLock key itself is pressed (#43)', () => {
      // The CapsLock key's own keydown reports an unreliable getModifierState
      // mid-toggle, so the indicator must track the toggle, not the reading.
      const capsKey = () => new KeyboardEvent('keydown', { key: 'CapsLock' });

      expect(hint()).toBeNull();

      component.onKeydown(capsKey());
      fixture.detectChanges();
      expect(hint()).not.toBeNull(); // on

      component.onKeydown(capsKey());
      fixture.detectChanges();
      expect(hint()).toBeNull(); // off

      component.onKeydown(capsKey());
      fixture.detectChanges();
      expect(hint()).not.toBeNull(); // on again
    });

    it('reveals the warning on the first pointer interaction when CapsLock is already on (#43)', () => {
      // A real click delivers a MouseEvent, which carries getModifierState.
      const pointerEvent = {
        getModifierState: (modifier: string) => modifier === 'CapsLock',
      } as unknown as Event;

      expect(hint()).toBeNull();

      component.onPointerOrFocus(pointerEvent);
      fixture.detectChanges();
      expect(hint()).not.toBeNull();
    });

    it('ignores a focus interaction that carries no modifier-state reading (#43)', () => {
      // A FocusEvent has no getModifierState; the path must no-op, not throw.
      expect(() => component.onPointerOrFocus({ type: 'focusin' } as Event)).not.toThrow();
      fixture.detectChanges();
      expect(hint()).toBeNull();
    });
  });

  describe('clean-reset and Zurücksetzen (#24)', () => {
    let httpMock: HttpTestingController;

    afterEach(() => localStorage.clear());

    beforeEach(async () => {
      httpMock = await setupCreateMode();
    });

    function fillValidWiederfang(): void {
      component.entryForm.patchValue({
        ringing_station: { handle: 'STAMT', name: 'Linz' } as never,
        staff: { id: 'p1', handle: 'FRE', full_name: 'Filip Reiter' } as never,
        species: { id: 's1', common_name_de: 'Kohlmeise' } as never,
        bird_status: BirdStatus.ReCatch,
        ring_size: RingSize.S,
        ring_number: '901234',
      });
    }

    function submitForm(): void {
      // Go through the real form submit so the FormGroupDirective marks itself
      // submitted — the exact state that makes empty required fields show errors.
      const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
      form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    }

    it('shows no required-field errors after a successful save and focuses the species field', fakeAsync(() => {
      fillValidWiederfang();
      submitForm();

      httpMock
        .expectOne((r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'))
        .flush({});
      fixture.detectChanges();

      // The bird-specific fields are empty again, but the form is pristine and no
      // longer "submitted", so Material renders no error messages.
      expect(fixture.nativeElement.querySelectorAll('mat-error').length).toBe(0);
      const species = fixture.nativeElement.querySelector('[formControlName="species"]');
      expect(document.activeElement).toBe(species);

      tick(900); // drain the brief "Gespeichert ✓" timer
    }));

    it('keeps Station and Beringer, clears the bird-specific fields and resets the date on save', fakeAsync(() => {
      const station = { handle: 'STAMT', name: 'Linz' };
      const beringer = { id: 'p1', handle: 'FRE', full_name: 'Filip Reiter' };
      fillValidWiederfang();
      component.entryForm.patchValue({
        ringing_station: station as never,
        staff: beringer as never,
        tarsus: 19,
        comment: 'Notiz',
      });
      submitForm();

      httpMock
        .expectOne((r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'))
        .flush({});
      tick(50);

      const form = component.entryForm;
      expect(form.get('ringing_station')!.value).toEqual(station as never);
      expect(form.get('staff')!.value).toEqual(beringer as never);
      expect(form.get('species')!.value).toBeNull();
      expect(form.get('ring_number')!.value).toBeNull();
      expect(form.get('bird_status')!.value).toBeNull();
      expect(form.get('tarsus')!.value).toBeNull();
      expect(form.get('comment')!.value).toBeNull();
      expect(form.get('date_time')!.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      // Pristine and untouched: the reset returns the form to a clean slate.
      expect(form.pristine).toBe(true);
      expect(form.untouched).toBe(true);

      tick(900);
    }));

    const species = { id: 's1', common_name_de: 'Kohlmeise' };

    // The component imports MatDialogModule, so it holds its own MatDialog
    // instance — spy on that one, not the root injector's.
    const spyOnDialog = (confirmed?: boolean) =>
      spyOn((component as unknown as { dialog: MatDialog }).dialog, 'open').and.returnValue({
        afterClosed: () => of(confirmed),
      } as never);

    it('resets without a confirmation when the form is not dirty', () => {
      const openSpy = spyOnDialog();
      expect(component.entryForm.dirty).toBe(false);

      component.onReset();

      expect(openSpy).not.toHaveBeenCalled();
    });

    it('confirms before resetting when the form has unsaved changes, and resets on confirm', () => {
      const openSpy = spyOnDialog(true);
      component.entryForm.get('species')!.setValue(species as never);
      component.entryForm.markAsDirty();

      component.onReset();

      expect(openSpy).toHaveBeenCalled();
      expect(component.entryForm.get('species')!.value).toBeNull();
      expect(component.entryForm.pristine).toBe(true);
    });

    it('keeps the changes when the confirmation is dismissed', () => {
      spyOnDialog(false);
      component.entryForm.get('species')!.setValue(species as never);
      component.entryForm.markAsDirty();

      component.onReset();

      expect(component.entryForm.get('species')!.value).toEqual(species as never);
      expect(component.entryForm.dirty).toBe(true);
    });

    it('renders a Zurücksetzen button in place of Abbrechen and wires it to onReset', () => {
      const labels = Array.from(
        fixture.nativeElement.querySelectorAll('.action-buttons button'),
      ).map((b) => (b as HTMLElement).textContent!.trim());
      expect(labels).toContain('Zurücksetzen');
      expect(labels).not.toContain('Abbrechen');
      // No list navigation in create mode — that button belongs to edit mode only.
      expect(labels).not.toContain('Zur Liste');

      const resetButton = Array.from(
        fixture.nativeElement.querySelectorAll('.action-buttons button'),
      ).find((b) => (b as HTMLElement).textContent!.trim() === 'Zurücksetzen') as HTMLButtonElement;
      const spy = spyOn(component, 'onReset');
      resetButton.click();
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('capture idempotency key (#155, offline outbox groundwork)', () => {
    const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let httpMock: HttpTestingController;

    afterEach(() => localStorage.clear());

    beforeEach(async () => {
      httpMock = await setupCreateMode();
    });

    function fillValidWiederfang(): void {
      component.entryForm.patchValue({
        ringing_station: { handle: 'STAMT', name: 'Linz' } as never,
        staff: { id: 'p1', handle: 'FRE', full_name: 'Filip Reiter' } as never,
        species: { id: 's1', common_name_de: 'Kohlmeise' } as never,
        bird_status: BirdStatus.ReCatch,
        ring_size: RingSize.S,
        ring_number: '901234',
      });
    }

    it('sends a fresh client-generated UUID as idempotency_key on create', () => {
      fillValidWiederfang();
      component.onSubmit();

      const post = httpMock.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'),
      );
      expect(post.request.body.idempotency_key).toMatch(UUID_PATTERN);
      post.flush({});
    });

    it('sends a different idempotency_key for the next capture after a successful save', fakeAsync(() => {
      fillValidWiederfang();
      component.onSubmit();
      const firstPost = httpMock.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'),
      );
      const firstKey = firstPost.request.body.idempotency_key;
      firstPost.flush({});
      tick(900); // drain the "Gespeichert ✓" timer started by cleanReset()

      fillValidWiederfang();
      component.onSubmit();
      const secondPost = httpMock.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'),
      );
      expect(secondPost.request.body.idempotency_key).not.toBe(firstKey);
      secondPost.flush({});
      tick(900);
    }));

    it('#155: reuses the same idempotency_key on an unedited resubmit after a failed save (true retry)', () => {
      fillValidWiederfang();
      component.onSubmit();
      const firstPost = httpMock.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'),
      );
      const firstKey = firstPost.request.body.idempotency_key;
      // A genuine server-side failure (not a connectivity loss — status 0 is
      // now #160's offline-outbox trigger, exercised in its own describe
      // block below) that still leaves the create unsaved and requiring a
      // manual resubmit.
      firstPost.flush({detail: 'Serverfehler'}, {status: 500, statusText: 'Internal Server Error'});

      // No edits — the user just hits save again after the error, exactly the
      // true retry the key exists for.
      component.onSubmit();
      const retryPost = httpMock.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'),
      );
      expect(retryPost.request.body.idempotency_key).toBe(firstKey);
      retryPost.flush({});
    });

    it('#155: mints a fresh idempotency_key when the form is edited before resubmitting after a failed save', () => {
      fillValidWiederfang();
      component.onSubmit();
      const firstPost = httpMock.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'),
      );
      const firstKey = firstPost.request.body.idempotency_key;
      // A genuine server-side failure (not a connectivity loss — see the
      // #160 offline-outbox describe block below for that case) that still
      // leaves the create unsaved.
      firstPost.flush({detail: 'Serverfehler'}, {status: 500, statusText: 'Internal Server Error'});

      // The user corrects a field before hitting submit again — replaying the
      // stale key would risk create_capture() silently returning the original
      // record instead of saving this edit.
      component.entryForm.patchValue({ring_number: '901235'});
      component.onSubmit();
      const secondPost = httpMock.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'),
      );
      expect(secondPost.request.body.idempotency_key).not.toBe(firstKey);
      expect(secondPost.request.body.ring_number).toBe('901235');
      secondPost.flush({});
    });
  });

  describe('offline durable outbox (#160): submitting offline enqueues instead of erroring', () => {
    const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let httpMock: HttpTestingController;

    // The offline outbox writes through to the real (Zone-unpatched) browser
    // IndexedDB — see offline-readiness.spec.ts's `settle()` for why neither
    // `fixture.whenStable()` nor a plain microtask await observes its
    // completion, only real elapsed time does. Polling a condition (rather
    // than a single fixed delay) keeps this robust under the variable
    // IndexedDB latency this large a spec run produces.
    async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
      const start = Date.now();
      while (!predicate()) {
        if (Date.now() - start > timeoutMs) {
          throw new Error('Timed out waiting for the offline outbox write to settle.');
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    afterEach(async () => {
      localStorage.clear();
      const db = TestBed.inject(IndexedDbStore);
      const entries = await db.getAll<{id: string}>('outbox');
      await Promise.all(entries.map((entry) => db.delete('outbox', entry.id)));
    });

    beforeEach(async () => {
      httpMock = await setupCreateMode();
      // The outbox (issue #160) stamps every enqueued entry with the
      // currently authenticated account (tenancy fix) — an entry can only
      // be durably queued once someone is signed in, exactly like in the
      // app (the capture form sits behind `authGuard`).
      TestBed.inject(AuthService).currentUser.set({
        username: 'fre',
        handle: 'FRE',
        isStaff: false,
        rolle: 'mitglied',
        organization: null,
      });
    });

    function fillValidWiederfang(): void {
      component.entryForm.patchValue({
        ringing_station: { handle: 'STAMT', name: 'Linz' } as never,
        staff: { id: 'p1', handle: 'FRE', full_name: 'Filip Reiter' } as never,
        species: { id: 's1', common_name_de: 'Kohlmeise' } as never,
        bird_status: BirdStatus.ReCatch,
        ring_size: RingSize.S,
        ring_number: '901234',
      });
    }

    // A genuine network-level failure (status 0) is what `HttpErrorResponse`
    // reports for a real connectivity loss (issue #159's established
    // convention) — the offline simulation used throughout PRD #152.
    function respondOffline(): void {
      httpMock
        .expectOne((r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'))
        .error(new ProgressEvent('error'));
    }

    it('enqueues a durable outbox entry carrying the idempotency UUID instead of failing the save', async () => {
      const outboxStore = TestBed.inject(OutboxStoreService);

      fillValidWiederfang();
      component.onSubmit();
      respondOffline();
      // `patchValue()` never marks the form dirty (only real DOM interaction
      // or the reset directive does), so `pristine` is uninformative here —
      // poll a value cleanReset() is known to clear instead.
      await waitUntil(() => component.entryForm.get('species')!.value === null);

      const entries = await outboxStore.list();
      expect(entries.length).toBe(1);
      expect(entries[0].id).toMatch(UUID_PATTERN);
      expect((entries[0].payload as {idempotency_key?: string}).idempotency_key).toBe(entries[0].id);
      expect((entries[0].payload as {ring_number?: string}).ring_number).toBe('901234');
    });

    it('increments the visible pending count in the outbox service', async () => {
      const outbox = TestBed.inject(OutboxService);
      await outbox.ready;
      expect(outbox.pendingCount()).toBe(0);

      fillValidWiederfang();
      component.onSubmit();
      respondOffline();
      await waitUntil(() => outbox.pendingCount() === 1);

      expect(outbox.pendingCount()).toBe(1);
    });

    it('behaves identically to an online save: no error snackbar, and the same clean-reset (Station + Beringer kept)', async () => {
      // The component imports MatSnackBarModule, so it holds its own
      // MatSnackBar instance — spy on that one, not the root injector's
      // (mirrors the MatDialog spy pattern used elsewhere in this file).
      const openSpy = spyOn(
        (component as unknown as { snackBar: MatSnackBar }).snackBar,
        'open',
      ).and.callThrough();

      fillValidWiederfang();
      component.onSubmit();
      respondOffline();
      // `patchValue()` never marks the form dirty (only real DOM interaction
      // or the reset directive does), so `pristine` is uninformative here —
      // poll a value cleanReset() is known to clear instead.
      await waitUntil(() => component.entryForm.get('species')!.value === null);
      fixture.detectChanges();

      expect(openSpy).toHaveBeenCalledWith(
        'Beringungseintrag gespeichert.',
        undefined,
        jasmine.any(Object),
      );
      expect(component.entryForm.get('ringing_station')!.value).toEqual({
        handle: 'STAMT',
        name: 'Linz',
      } as never);
      expect(component.entryForm.get('staff')!.value).toEqual({
        id: 'p1',
        handle: 'FRE',
        full_name: 'Filip Reiter',
      } as never);
      expect(component.entryForm.get('species')!.value).toBeNull();
      expect(component.entryForm.pristine).toBe(true);
    });

    it('mints the next capture a fresh idempotency key after an offline-queued save, just like an online one', async () => {
      fillValidWiederfang();
      component.onSubmit();
      const firstPost = httpMock.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'),
      );
      const firstKey = firstPost.request.body.idempotency_key;
      firstPost.error(new ProgressEvent('error'));
      // `patchValue()` never marks the form dirty (only real DOM interaction
      // or the reset directive does), so `pristine` is uninformative here —
      // poll a value cleanReset() is known to clear instead.
      await waitUntil(() => component.entryForm.get('species')!.value === null);

      fillValidWiederfang();
      component.onSubmit();
      const secondPost = httpMock.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'),
      );
      expect(secondPost.request.body.idempotency_key).not.toBe(firstKey);
      secondPost.error(new ProgressEvent('error'));
      // `patchValue()` never marks the form dirty (only real DOM interaction
      // or the reset directive does), so `pristine` is uninformative here —
      // poll a value cleanReset() is known to clear instead.
      await waitUntil(() => component.entryForm.get('species')!.value === null);
    });
  });

  // Issue #162 extends the #160 tracer bullet to every capture kind. A
  // Wiederfang offline-enqueue is already proven above (the #160 describe
  // block's own `fillValidWiederfang()` fixture *is* a Wiederfang — chosen
  // there precisely because BirdStatus.ReCatch never triggers the
  // Ringnummer-suggestion effect, keeping that block's HTTP mocking minimal).
  // This block covers what #160 did not: the two Sonderarten.
  describe('offline Sonderarten (#162): Ring vernichtet and Aves ignota enqueue like any other capture', () => {
    let httpMock: HttpTestingController;

    const RING_VERNICHTET: Species = {
      id: 'sent',
      common_name_de: 'Ring Vernichtet',
      common_name_en: '',
      scientific_name: '',
      family_name: '',
      order_name: '',
      ring_size: null,
      special_kind: 'ring_destroyed',
    };

    const AVES_IGNOTA: Species = {
      id: 'aves',
      common_name_de: 'Art nicht in der Liste (Aves ignota)',
      common_name_en: 'Species not listed',
      scientific_name: 'Aves ignota',
      family_name: '—',
      order_name: '—',
      ring_size: null,
      special_kind: 'unknown_species',
    };

    function selectSpecies(species: Species): void {
      component.onSpeciesSelected({ option: { value: species } } as MatAutocompleteSelectedEvent);
      fixture.detectChanges();
    }

    // A genuine network-level failure (status 0) — the offline simulation
    // used throughout PRD #152 (see the #160 describe block above).
    function respondOffline(): void {
      httpMock
        .expectOne((r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'))
        .error(new ProgressEvent('error'));
    }

    // Same real-IndexedDB polling rationale as the #160 block above.
    async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
      const start = Date.now();
      while (!predicate()) {
        if (Date.now() - start > timeoutMs) {
          throw new Error('Timed out waiting for the offline outbox write to settle.');
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    afterEach(async () => {
      localStorage.clear();
      const db = TestBed.inject(IndexedDbStore);
      const entries = await db.getAll<{ id: string }>('outbox');
      await Promise.all(entries.map((entry) => db.delete('outbox', entry.id)));
    });

    beforeEach(async () => {
      httpMock = await setupCreateMode();
      TestBed.inject(AuthService).currentUser.set({
        username: 'fre',
        handle: 'FRE',
        isStaff: false,
        rolle: 'mitglied',
        organization: null,
      });
    });

    it('enqueues a Ring vernichtet capture offline once the collapsed form is filled in', async () => {
      const form = component.entryForm;
      form.patchValue({
        ringing_station: { handle: 'STAMT', name: 'Linz' } as never,
        staff: { id: 'p1', handle: 'FRE', full_name: 'Filip Reiter' } as never,
        species: RING_VERNICHTET as never,
        ring_size: RingSize.S,
        ring_number: '901234',
      });
      selectSpecies(RING_VERNICHTET);

      expect(component.isRingDestroyed()).toBe(true);
      expect(form.valid).toBe(true);

      component.onSubmit();
      respondOffline();
      await waitUntil(() => component.entryForm.get('species')!.value === null);

      const entries = await TestBed.inject(OutboxStoreService).list();
      expect(entries.length).toBe(1);
      const payload = entries[0].payload as { species_id?: string; ring_number?: string };
      expect(payload.species_id).toBe(RING_VERNICHTET.id);
      expect(payload.ring_number).toBe('901234');
    });

    it('refuses to submit an Aves ignota capture offline without the mandatory Bemerkung, and never enqueues it', async () => {
      const form = component.entryForm;
      form.patchValue({
        ringing_station: { handle: 'STAMT', name: 'Linz' } as never,
        staff: { id: 'p1', handle: 'FRE', full_name: 'Filip Reiter' } as never,
        species: AVES_IGNOTA as never,
        bird_status: BirdStatus.ReCatch,
        ring_size: RingSize.S,
        ring_number: '901234',
        comment: null,
      });
      selectSpecies(AVES_IGNOTA);

      expect(component.isUnknownSpecies()).toBe(true);
      expect(form.invalid).toBe(true);

      component.onSubmit();

      httpMock.expectNone((r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'));
      const entries = await TestBed.inject(OutboxStoreService).list();
      expect(entries.length).toBe(0);
    });

    it('enqueues an Aves ignota capture offline once the mandatory Bemerkung is filled in, exactly as online', async () => {
      const form = component.entryForm;
      form.patchValue({
        ringing_station: { handle: 'STAMT', name: 'Linz' } as never,
        staff: { id: 'p1', handle: 'FRE', full_name: 'Filip Reiter' } as never,
        species: AVES_IGNOTA as never,
        bird_status: BirdStatus.ReCatch,
        ring_size: RingSize.S,
        ring_number: '901234',
        comment: 'Seltener Irrgast, nicht sicher bestimmbar.',
      });
      selectSpecies(AVES_IGNOTA);

      expect(form.valid).toBe(true);

      component.onSubmit();
      respondOffline();
      await waitUntil(() => component.entryForm.get('species')!.value === null);

      const entries = await TestBed.inject(OutboxStoreService).list();
      expect(entries.length).toBe(1);
      const payload = entries[0].payload as { species_id?: string; comment?: string };
      expect(payload.species_id).toBe(AVES_IGNOTA.id);
      expect(payload.comment).toBe('Seltener Irrgast, nicht sicher bestimmbar.');
    });
  });

  describe('inline autocomplete validation for Art/Station/Beringer (#58)', () => {
    let httpMock: HttpTestingController;

    afterEach(() => localStorage.clear());

    beforeEach(async () => {
      httpMock = await setupCreateMode();
    });

    const field = (name: string): HTMLElement =>
      (fixture.nativeElement.querySelector(`[formControlName="${name}"]`) as HTMLElement).closest(
        'mat-form-field',
      ) as HTMLElement;

    const errorsIn = (name: string): string[] =>
      Array.from(field(name).querySelectorAll('mat-error')).map((e) =>
        (e as HTMLElement).textContent!.trim(),
      );

    it('marks the Art control invalid with an unmatchedOption error for typed free text', () => {
      component.entryForm.get('species')!.setValue('Kohlmeisx' as never);

      expect(component.entryForm.get('species')!.hasError('unmatchedOption')).toBe(true);
      expect(component.entryForm.invalid).toBe(true);
    });

    it('accepts a real selected record (no error) once an option is chosen', () => {
      component.entryForm
        .get('species')!
        .setValue({ id: 's1', common_name_de: 'Kohlmeise' } as never);

      expect(component.entryForm.get('species')!.hasError('unmatchedOption')).toBe(false);
      expect(component.entryForm.get('species')!.valid).toBe(true);
    });

    it('surfaces the Art message on blur/submit, never while still typing', () => {
      const species = component.entryForm.get('species')!;
      species.setValue('Kohlmeisx' as never);
      fixture.detectChanges();
      // While typing (untouched, not submitted) the field shows no error.
      expect(errorsIn('species')).toEqual([]);

      species.markAsTouched();
      fixture.detectChanges();
      expect(errorsIn('species')).toContain('Unbekannte Art – bitte aus der Liste wählen');
    });

    it('applies the same rule with its own message to Station and Beringer', () => {
      component.entryForm.get('ringing_station')!.setValue('Linzz' as never);
      component.entryForm.get('staff')!.setValue('FREX' as never);
      component.entryForm.get('ringing_station')!.markAsTouched();
      component.entryForm.get('staff')!.markAsTouched();
      fixture.detectChanges();

      expect(component.entryForm.get('ringing_station')!.hasError('unmatchedOption')).toBe(true);
      expect(component.entryForm.get('staff')!.hasError('unmatchedOption')).toBe(true);
      expect(errorsIn('ringing_station')).toContain(
        'Unbekannte Station – bitte aus der Liste wählen',
      );
      expect(errorsIn('staff')).toContain('Unbekannter Beringer – bitte aus der Liste wählen');
    });

    it('fires no POST while a control holds unmatched free text, keeping the typed text', () => {
      component.entryForm.patchValue({
        ringing_station: { handle: 'STAMT', name: 'Linz' } as never,
        staff: { id: 'p1', handle: 'FRE', full_name: 'Filip Reiter' } as never,
        bird_status: BirdStatus.ReCatch,
        ring_size: RingSize.S,
        ring_number: '901234',
      });
      // Art typed but never picked from the list.
      component.entryForm.get('species')!.setValue('Kohlmeisx' as never);

      component.onSubmit();

      httpMock.expectNone((r) => r.method === 'POST');
      // The typed text stays so the Beringer fixes the spelling instead of retyping.
      expect(component.entryForm.get('species')!.value as unknown).toBe('Kohlmeisx');
    });
  });

  describe('Zentrale field in the ring block — ausländischer Wiederfang (#232)', () => {
    let httpMock: HttpTestingController;

    afterEach(() => localStorage.clear());

    beforeEach(async () => {
      httpMock = await setupCreateMode();
    });

    const SLOVAK: Central = {
      id: 'c-skb',
      scheme_code: 'SKB',
      name: 'Slowakei Bratislava',
      country: 'Slowakei',
    };

    const RING_VERNICHTET: Species = {
      id: 'sent',
      common_name_de: 'Ring Vernichtet',
      common_name_en: '',
      scientific_name: '',
      family_name: '',
      order_name: '',
      ring_size: null,
      special_kind: 'ring_destroyed',
    };

    const central = () => component.entryForm.get('central')!;
    const has = (selector: string) => fixture.nativeElement.querySelector(selector) !== null;

    function setStatus(status: BirdStatus): void {
      component.entryForm.get('bird_status')!.setValue(status);
      fixture.detectChanges();
    }

    function chooseForeignCentral(): void {
      setStatus(BirdStatus.ReCatch);
      central().setValue(SLOVAK as never);
      fixture.detectChanges();
    }

    // The Erstfang next-number effect fires a GET the instant Status is Erstfang
    // with a Ringgröße set; these Zentrale tests do not care about it, so drain
    // any pending suggestion request so it never masks a real assertion.
    function drainNextNumber(): void {
      httpMock
        .match((r) => r.url.endsWith('/birds/rings/next-number/'))
        .forEach((req) => req.flush({ next_number: null }));
    }

    // --- field gating by Status (US 2, 3, 4, 5) ---

    it('disables the Zentrale and forces it to the Projekt-Zentrale on Erstfang', () => {
      setStatus(BirdStatus.FirstCatch);

      expect(central().disabled).toBe(true);
      expect((central().value as Central).scheme_code).toBe(AUW_SCHEME_CODE);
      expect(component.isForeignCentral()).toBe(false);
      // Visible but disabled — never removed from the ring block.
      expect(has('[formControlName="central"]')).toBe(true);
    });

    it('enables the Zentrale and prefills it with the Projekt-Zentrale on Wiederfang', () => {
      setStatus(BirdStatus.ReCatch);

      expect(central().enabled).toBe(true);
      expect((central().value as Central).scheme_code).toBe(AUW_SCHEME_CODE);
      expect(has('[formControlName="central"]')).toBe(true);
    });

    it('disables the Zentrale and forces the Projekt-Zentrale on a Ring-vernichtet record', () => {
      component.onSpeciesSelected({
        option: { value: RING_VERNICHTET },
      } as MatAutocompleteSelectedEvent);
      fixture.detectChanges();

      expect(component.isRingDestroyed()).toBe(true);
      expect(central().disabled).toBe(true);
      expect((central().value as Central).scheme_code).toBe(AUW_SCHEME_CODE);
      expect(has('[formControlName="central"]')).toBe(true);
    });

    it('places the Zentrale between Status and Ringgröße in the ring block', () => {
      setStatus(BirdStatus.ReCatch);

      const order = Array.from(
        fixture.nativeElement.querySelectorAll('[formControlName]'),
      ).map((el) => (el as HTMLElement).getAttribute('formControlName'));
      const statusIdx = order.indexOf('bird_status');
      const centralIdx = order.indexOf('central');
      const sizeIdx = order.indexOf('ring_size');

      expect(statusIdx).toBeGreaterThanOrEqual(0);
      expect(centralIdx).toBeGreaterThan(statusIdx);
      expect(sizeIdx).toBeGreaterThan(centralIdx);
    });

    // --- free-text switching in both directions (US 6, 7, 8, 11, 12) ---

    it('switches Ringgröße to free-text and drops the Ringnummer numeric pattern for a foreign Zentrale', () => {
      chooseForeignCentral();

      expect(component.isForeignCentral()).toBe(true);
      expect(has('[data-testid="ring-size-freetext"]')).toBe(true);
      expect(has('[data-testid="ring-size-dropdown"]')).toBe(false);

      // A ring number with letters is now accepted (no pattern error).
      component.entryForm.get('ring_number')!.setValue('SA12345');
      expect(component.entryForm.get('ring_number')!.hasError('pattern')).toBe(false);
    });

    it('restores the strict dropdown and clears a non-Austrian Größe when switching back to the Projekt-Zentrale', () => {
      chooseForeignCentral();
      component.entryForm.get('ring_size')!.setValue('12A' as never);
      component.entryForm.get('ring_number')!.setValue('SA123');
      fixture.detectChanges();

      central().setValue(PROJEKT_ZENTRALE as never);
      fixture.detectChanges();

      expect(component.isForeignCentral()).toBe(false);
      expect(has('[data-testid="ring-size-dropdown"]')).toBe(true);
      expect(has('[data-testid="ring-size-freetext"]')).toBe(false);
      // The non-Austrian free-text size is cleared so the restored dropdown never
      // opens on an unlisted value.
      expect(component.entryForm.get('ring_size')!.value).toBeNull();
      // The numeric-only pattern is back.
      component.entryForm.get('ring_number')!.setValue('SA123');
      expect(component.entryForm.get('ring_number')!.hasError('pattern')).toBe(true);
    });

    it('keeps the strict Austrian dropdown throughout a domestic Wiederfang of an AUW ring', () => {
      setStatus(BirdStatus.ReCatch);
      component.entryForm.get('ring_size')!.setValue(RingSize.S);
      fixture.detectChanges();

      expect(component.isForeignCentral()).toBe(false);
      expect(has('[data-testid="ring-size-dropdown"]')).toBe(true);
      expect(has('[data-testid="ring-size-freetext"]')).toBe(false);
      expect(component.entryForm.get('ring_size')!.value).toBe(RingSize.S);
    });

    // --- Empfohlene-Ringgröße prefill suppression (US 8) ---

    it('suppresses the Empfohlene-Ringgröße prefill while a foreign Zentrale is selected', () => {
      chooseForeignCentral();
      const speciesWithSize: Species = {
        id: 's1',
        common_name_de: 'Kohlmeise',
        common_name_en: '',
        scientific_name: 'Parus major',
        family_name: '',
        order_name: '',
        ring_size: RingSize.S,
        special_kind: '',
      };

      component.onSpeciesSelected({
        option: { value: speciesWithSize },
      } as MatAutocompleteSelectedEvent);

      expect(component.entryForm.get('ring_size')!.value).not.toBe(RingSize.S);
    });

    it('still prefills the Empfohlene-Ringgröße for a domestic capture', () => {
      setStatus(BirdStatus.ReCatch);
      const speciesWithSize: Species = {
        id: 's1',
        common_name_de: 'Kohlmeise',
        common_name_en: '',
        scientific_name: 'Parus major',
        family_name: '',
        order_name: '',
        ring_size: RingSize.S,
        special_kind: '',
      };

      component.onSpeciesSelected({
        option: { value: speciesWithSize },
      } as MatAutocompleteSelectedEvent);

      expect(component.entryForm.get('ring_size')!.value).toBe(RingSize.S);
    });

    // --- resets: status flip + after save (US 9, 10) ---

    it('resets the Zentrale to the Projekt default when Status flips back to Erstfang', () => {
      chooseForeignCentral();
      component.entryForm.get('ring_size')!.setValue('12A' as never);
      fixture.detectChanges();
      expect(component.isForeignCentral()).toBe(true);

      setStatus(BirdStatus.FirstCatch);
      drainNextNumber();

      expect((central().value as Central).scheme_code).toBe(AUW_SCHEME_CODE);
      expect(central().disabled).toBe(true);
      expect(component.isForeignCentral()).toBe(false);
      // The foreign free-text Größe is dropped when the strict dropdown returns.
      expect(component.entryForm.get('ring_size')!.value).toBeNull();
    });

    function fillValidForeignWiederfang(): void {
      setStatus(BirdStatus.ReCatch);
      central().setValue(SLOVAK as never);
      fixture.detectChanges();
      component.entryForm.patchValue({
        ringing_station: { handle: 'STAMT', name: 'Linz' } as never,
        staff: { id: 'p1', handle: 'FRE', full_name: 'Filip Reiter' } as never,
        species: { id: 's1', common_name_de: 'Kohlmeise' } as never,
        ring_size: 'SA' as never,
        ring_number: 'AB1234',
      });
    }

    it('submits a foreign Wiederfang with the Zentrale carried flat as its scheme code', () => {
      fillValidForeignWiederfang();

      component.onSubmit();

      const post = httpMock.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'),
      );
      expect(post.request.body.central).toBe('SKB');
      expect(post.request.body.ring_number).toBe('AB1234');
      post.flush({});
    });

    it('resets the Zentrale to the Projekt default after a save (not sticky across saves)', fakeAsync(() => {
      fillValidForeignWiederfang();

      component.onSubmit();
      httpMock
        .expectOne((r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'))
        .flush({});

      expect((central().value as Central).scheme_code).toBe(AUW_SCHEME_CODE);
      expect(component.isForeignCentral()).toBe(false);

      tick(900); // drain the brief "Gespeichert ✓" timer
    }));

    it('omits the Zentrale from a domestic capture payload (same effective semantics as today)', () => {
      setStatus(BirdStatus.ReCatch);
      component.entryForm.patchValue({
        ringing_station: { handle: 'STAMT', name: 'Linz' } as never,
        staff: { id: 'p1', handle: 'FRE', full_name: 'Filip Reiter' } as never,
        species: { id: 's1', common_name_de: 'Kohlmeise' } as never,
        ring_size: RingSize.S,
        ring_number: '901234',
      });

      component.onSubmit();

      const post = httpMock.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'),
      );
      expect('central' in post.request.body).toBe(false);
      post.flush({});
    });

    it('blocks submitting a typed-but-unpicked Zentrale (selectedOptionValidator)', () => {
      setStatus(BirdStatus.ReCatch);
      component.entryForm.patchValue({
        ringing_station: { handle: 'STAMT', name: 'Linz' } as never,
        staff: { id: 'p1', handle: 'FRE', full_name: 'Filip Reiter' } as never,
        species: { id: 's1', common_name_de: 'Kohlmeise' } as never,
        ring_size: RingSize.S,
        ring_number: '901234',
      });
      // Free text typed into the Zentrale field, never confirmed from the list.
      central().setValue('Slowak' as never);

      expect(central().hasError('unmatchedOption')).toBe(true);
      component.onSubmit();

      httpMock.expectNone((r) => r.method === 'POST');
    });
  });

  describe('edit mode with a foreign ring keys off the stored Zentrale (#232, US 13)', () => {
    const SLOVAK: Central = {
      id: 'c-skb',
      scheme_code: 'SKB',
      name: 'Slowakei Bratislava',
      country: 'Slowakei',
    };

    function foreignEntry(): DataEntry {
      return {
        id: '77',
        species: {
          id: 's1',
          common_name_de: 'Kohlmeise',
          scientific_name: 'Parus major',
          ring_size: RingSize.S,
        },
        ring: { id: 'r1', number: 'AB123', size: 'SA' as RingSize, central: SLOVAK },
        staff: { id: 'p1', handle: 'FRE', full_name: 'Filip Reiter' },
        ringing_station: {
          handle: 'STAMT',
          name: 'Linz, Botanischer Garten',
          organization: { id: 'o1', handle: 'IWM', name: 'IWM Linz', country: 'AT' },
        },
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
        bird_status: BirdStatus.ReCatch,
        fat_deposit: null,
        muscle_class: null,
        age_class: AgeClass.ThisYear,
        sex: Sex.Female,
        small_feather_int: null,
        small_feather_app: null,
        hand_wing: null,
        date_time: '2024-05-01T08:30:00Z',
        created: '2024-05-01T08:30:00Z',
        updated: '2024-05-01T08:30:00Z',
        comment: null,
        has_mites: false,
        has_hunger_stripes: false,
        has_brood_patch: false,
        has_cpl_plus: false,
      } as unknown as DataEntry;
    }

    async function setupEditMode(entryId: string) {
      const routeStub = {
        snapshot: { paramMap: { get: (key: string) => (key === 'id' ? entryId : null) } },
      };
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [DataEntryFormComponent],
        providers: [
          provideRouter([]),
          provideHttpClient(),
          provideHttpClientTesting(),
          provideNoopAnimations(),
          { provide: ActivatedRoute, useValue: routeStub },
        ],
      }).compileComponents();
      const f = TestBed.createComponent(DataEntryFormComponent);
      const httpMock = TestBed.inject(HttpTestingController);
      return { f, httpMock };
    }

    it('reopens a foreign-ring entry in free-text mode with the stored Zentrale', async () => {
      const { f, httpMock } = await setupEditMode('77');
      f.detectChanges();
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/data-entries/77/'))
        .flush(foreignEntry());
      f.detectChanges();

      const form = f.componentInstance.entryForm;
      expect(f.componentInstance.isForeignCentral()).toBe(true);
      expect((form.get('central')!.value as Central).scheme_code).toBe('SKB');
      expect(form.get('ring_size')!.value as unknown as string).toBe('SA');
      expect(f.nativeElement.querySelector('[data-testid="ring-size-freetext"]')).not.toBeNull();
      expect(f.nativeElement.querySelector('[data-testid="ring-size-dropdown"]')).toBeNull();
    });
  });

  // PRD #245, issue #246: the client-side Plausibilitätsprüfung. A normed Art
  // plus an out-of-range Gewicht raises an inline Plausibilitätswarnung under the
  // field on blur (the sex-contradiction role="alert" idiom); on submit an active
  // warning routes through ONE aggregated confirm-dialog whose acknowledgment is
  // transient — never persisted. Identical in create and edit mode.
  describe('Plausibilitätswarnung (Artennorm, PRD #245)', () => {
    // A Zaunkönig norm with all six σ-bands set (k 1,96): Gewicht Ø 9,1 g SD 0,82
    // → 7,5–10,7 g; and the five #247 measurements (mm): Federlänge Ø 54 SD 2 →
    // 50,1–57,9; Flügellänge Ø 73 SD 2,5 → 68,1–77,9; Tarsus Ø 19 SD 0,6 →
    // 17,8–20,2; Kerbe F2 Ø 8 SD 0,7 → 6,6–9,4; Innenfuß Ø 15 SD 0,8 → 13,4–16,6.
    const norm: SpeciesNorm = {
      species_id: 's1',
      species_name: 'Zaunkönig',
      weight_mean: '9.1',
      weight_sd: '0.82',
      feather_mean: '54',
      feather_sd: '2',
      wing_mean: '73',
      wing_sd: '2.5',
      tarsus_mean: '19',
      tarsus_sd: '0.6',
      notch_f2_mean: '8',
      notch_f2_sd: '0.7',
      inner_foot_mean: '15',
      inner_foot_sd: '0.8',
      quotient_mean: null,
      quotient_tolerance_pct: null,
      sd_factor: '1.96',
      geschlechtsbestimmung_moeglich: null,
      dj_grossgefiedermauser_moeglich: null,
    };
    const zaunkoenig: Species = {
      id: 's1',
      common_name_de: 'Zaunkönig',
      common_name_en: 'Wren',
      scientific_name: 'Troglodytes troglodytes',
      family_name: '',
      order_name: '',
      ring_size: RingSize.V,
      special_kind: '',
    };
    const unnormedSpecies: Species = { ...zaunkoenig, id: 's2', common_name_de: 'Kohlmeise' };
    const project = {
      id: 'p1',
      title: 'Herbst',
      description: '',
      show_optional_fields: true,
      organization: { id: 'o1', handle: 'IWM', name: 'IWM Linz', country: 'AT' },
      default_station: null,
      scientists: [],
      created: '',
      updated: '',
    } as Project;
    const bundle: OfflineBundle = {
      identity: { username: 'fre', handle: 'FRE', organization: null, rolle: 'mitglied' },
      species: [],
      ringing_stations: [],
      scientists: [],
      projects: [],
      centrals: [],
      norms: [norm],
      last_consumed_ring_numbers: [],
    };
    const cacheStub = {
      load: () => Promise.resolve({ bundle, refreshedAt: '2026-07-02T08:00:00.000Z' }),
      save: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    };
    const dialogMock = { open: jasmine.createSpy('open') };
    const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

    async function setup(): Promise<HttpTestingController> {
      TestBed.resetTestingModule();
      dialogMock.open.calls.reset();
      await TestBed.configureTestingModule({
        imports: [DataEntryFormComponent],
        providers: [
          provideRouter([]),
          provideHttpClient(),
          provideHttpClientTesting(),
          provideNoopAnimations(),
          {
            provide: ProjectService,
            useValue: {
              currentProject: signal<Project | null>(project),
              setCurrent: () => {},
              clear: () => {},
            },
          },
          { provide: ReferenceBundleCacheService, useValue: cacheStub },
        ],
      })
        .overrideComponent(DataEntryFormComponent, {
          add: { providers: [{ provide: MatDialog, useValue: dialogMock }] },
        })
        .compileComponents();
      fixture = TestBed.createComponent(DataEntryFormComponent);
      component = fixture.componentInstance;
      const httpMock = TestBed.inject(HttpTestingController);
      fixture.detectChanges();
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/species/'))
        .flush({ count: 0, next: null, previous: null, results: [] });
      // Let loadNorms() resolve from the (mocked) reference cache.
      await settle();
      return httpMock;
    }

    // Fill the required fields for a valid Wiederfang (no ring-number auto-fetch,
    // which only fires for an Erstfang), so onSubmit reaches the save gate.
    function fillValid(): void {
      component.entryForm.patchValue({
        ringing_station: { handle: 'STAMT', name: 'Linz' } as never,
        staff: { id: 'p1', handle: 'FRE', full_name: 'Filip Reiter' } as never,
        species: zaunkoenig as never,
        bird_status: BirdStatus.ReCatch,
        ring_size: RingSize.S,
        ring_number: '901234',
      });
      component.selectedSpecies.set(zaunkoenig);
    }

    const warningEl = () =>
      fixture.nativeElement.querySelector(
        '[data-testid="plausibility-weight-warning"]',
      ) as HTMLElement | null;

    it('renders the inline warning on blur for an out-of-range Gewicht, with the de-AT message', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);
      component.entryForm.get('weight_gram')!.setValue(25);
      component.onMeasurementBlur();
      fixture.detectChanges();

      const el = warningEl();
      expect(el).not.toBeNull();
      expect(el!.getAttribute('role')).toBe('alert');
      expect(el!.textContent).toContain(
        'Gewicht 25 g liegt außerhalb des erwarteten Bereichs 7,5–10,7 g (Zaunkönig)',
      );
    });

    it('renders no inline warning when the Gewicht is in range', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);
      component.entryForm.get('weight_gram')!.setValue(9);
      component.onMeasurementBlur();
      fixture.detectChanges();

      expect(warningEl()).toBeNull();
    });

    it('renders no inline warning when the selected Art carries no Artennorm', async () => {
      await setup();
      component.selectedSpecies.set(unnormedSpecies);
      component.entryForm.get('weight_gram')!.setValue(25);
      component.onMeasurementBlur();
      fixture.detectChanges();

      expect(warningEl()).toBeNull();
    });

    it('opens ONE aggregated confirm-dialog on submit when a warning is active, and writes on confirm', async () => {
      const httpMock = await setup();
      fillValid();
      component.entryForm.get('weight_gram')!.setValue(25);
      dialogMock.open.and.returnValue({ afterClosed: () => of(true) });

      component.onSubmit();

      expect(dialogMock.open).toHaveBeenCalledTimes(1);
      const data = dialogMock.open.calls.mostRecent().args[1].data as { message: string };
      expect(data.message).toContain('Gewicht 25 g liegt außerhalb');
      const post = httpMock.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'),
      );
      post.flush({});
    });

    it('returns to the form without writing when the confirm-dialog is cancelled', async () => {
      const httpMock = await setup();
      fillValid();
      component.entryForm.get('weight_gram')!.setValue(25);
      dialogMock.open.and.returnValue({ afterClosed: () => of(false) });

      component.onSubmit();

      expect(dialogMock.open).toHaveBeenCalledTimes(1);
      httpMock.expectNone((r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'));
    });

    it('opens no dialog and writes directly when no warning is active', async () => {
      const httpMock = await setup();
      fillValid();
      component.entryForm.get('weight_gram')!.setValue(9);

      component.onSubmit();

      expect(dialogMock.open).not.toHaveBeenCalled();
      const post = httpMock.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'),
      );
      post.flush({});
    });

    it('never persists the acknowledgment (no ack field on the write payload; the value rides unchanged)', async () => {
      const httpMock = await setup();
      fillValid();
      component.entryForm.get('weight_gram')!.setValue(25);
      dialogMock.open.and.returnValue({ afterClosed: () => of(true) });

      component.onSubmit();

      const post = httpMock.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'),
      );
      const body = post.request.body as Record<string, unknown>;
      expect('acknowledged' in body).toBe(false);
      expect('plausibility_acknowledged' in body).toBe(false);
      expect(body['weight_gram']).toBe(25);
      post.flush({});
    });

    it('applies the same warning + acknowledgment on submit in edit mode', async () => {
      const routeStub = {
        snapshot: { paramMap: { get: (key: string) => (key === 'id' ? '42' : null) } },
      };
      TestBed.resetTestingModule();
      dialogMock.open.calls.reset();
      await TestBed.configureTestingModule({
        imports: [DataEntryFormComponent],
        providers: [
          provideRouter([]),
          provideHttpClient(),
          provideHttpClientTesting(),
          provideNoopAnimations(),
          { provide: ActivatedRoute, useValue: routeStub },
          { provide: ReferenceBundleCacheService, useValue: cacheStub },
        ],
      })
        .overrideComponent(DataEntryFormComponent, {
          add: { providers: [{ provide: MatDialog, useValue: dialogMock }] },
        })
        .compileComponents();
      const f = TestBed.createComponent(DataEntryFormComponent);
      const httpMock = TestBed.inject(HttpTestingController);
      f.detectChanges();

      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/data-entries/42/'))
        .flush({
          id: '42',
          species: zaunkoenig,
          ring: { id: 'r1', number: '901234', size: RingSize.S },
          staff: { id: 'p1', handle: 'FRE', full_name: 'Filip Reiter' },
          ringing_station: { handle: 'STAMT', name: 'Linz', organization: project.organization },
          project: null,
          weight_gram: 25,
          bird_status: BirdStatus.ReCatch,
          age_class: AgeClass.ThisYear,
          sex: Sex.Female,
          date_time: '2024-05-01T08:30:00Z',
          has_mites: false,
          has_hunger_stripes: false,
          has_brood_patch: false,
          has_cpl_plus: false,
        } as unknown as DataEntry);
      await settle();

      dialogMock.open.and.returnValue({ afterClosed: () => of(true) });
      f.componentInstance.onSubmit();

      expect(dialogMock.open).toHaveBeenCalledTimes(1);
      const put = httpMock.expectOne(
        (r) => r.method === 'PUT' && r.url.endsWith('/birds/data-entries/42/'),
      );
      put.flush({});
    });

    // Issue #247: the remaining five σ-measurements get the identical inline
    // blur warning under their own field, keyed by field-specific testid, with
    // the same optionality (in-range → none) and the same de-AT message shape.
    interface FieldCase {
      label: string;
      field: string;
      testid: string;
      inRange: number;
      outOfRange: number;
      message: string;
    }
    const fieldCases: FieldCase[] = [
      {
        label: 'Federlänge',
        field: 'feather_span',
        testid: 'plausibility-feather_span-warning',
        inRange: 54,
        outOfRange: 65,
        message:
          'Federlänge 65 mm liegt außerhalb des erwarteten Bereichs 50,1–57,9 mm (Zaunkönig)',
      },
      {
        label: 'Flügellänge',
        field: 'wing_span',
        testid: 'plausibility-wing_span-warning',
        inRange: 73,
        outOfRange: 90,
        message:
          'Flügellänge 90 mm liegt außerhalb des erwarteten Bereichs 68,1–77,9 mm (Zaunkönig)',
      },
      {
        label: 'Tarsus',
        field: 'tarsus',
        testid: 'plausibility-tarsus-warning',
        inRange: 19,
        outOfRange: 25,
        message: 'Tarsus 25 mm liegt außerhalb des erwarteten Bereichs 17,8–20,2 mm (Zaunkönig)',
      },
      {
        label: 'Kerbe F2',
        field: 'notch_f2',
        testid: 'plausibility-notch_f2-warning',
        inRange: 8,
        outOfRange: 12,
        message: 'Kerbe F2 12 mm liegt außerhalb des erwarteten Bereichs 6,6–9,4 mm (Zaunkönig)',
      },
      {
        label: 'Innenfuß',
        field: 'inner_foot',
        testid: 'plausibility-inner_foot-warning',
        inRange: 15,
        outOfRange: 20,
        message: 'Innenfuß 20 mm liegt außerhalb des erwarteten Bereichs 13,4–16,6 mm (Zaunkönig)',
      },
    ];

    for (const c of fieldCases) {
      describe(`inline warning under ${c.label} (#247)`, () => {
        const el = () =>
          fixture.nativeElement.querySelector(
            `[data-testid="${c.testid}"]`,
          ) as HTMLElement | null;

        it('renders on blur for an out-of-range value, with the de-AT message', async () => {
          await setup();
          component.selectedSpecies.set(zaunkoenig);
          component.entryForm.get(c.field)!.setValue(c.outOfRange);
          component.onMeasurementBlur();
          fixture.detectChanges();

          const warning = el();
          expect(warning).not.toBeNull();
          expect(warning!.getAttribute('role')).toBe('alert');
          expect(warning!.textContent).toContain(c.message);
        });

        it('renders nothing when the value is in range', async () => {
          await setup();
          component.selectedSpecies.set(zaunkoenig);
          component.entryForm.get(c.field)!.setValue(c.inRange);
          component.onMeasurementBlur();
          fixture.detectChanges();

          expect(el()).toBeNull();
        });

        it('renders nothing when the selected Art carries no Artennorm', async () => {
          await setup();
          component.selectedSpecies.set(unnormedSpecies);
          component.entryForm.get(c.field)!.setValue(c.outOfRange);
          component.onMeasurementBlur();
          fixture.detectChanges();

          expect(el()).toBeNull();
        });
      });
    }

    it('aggregates every out-of-range measurement into ONE confirm-dialog on submit (not one per field)', async () => {
      const httpMock = await setup();
      fillValid();
      component.entryForm.patchValue({
        weight_gram: 25,
        feather_span: 65,
        wing_span: 90,
        tarsus: 25,
        notch_f2: 12,
        inner_foot: 20,
      });
      dialogMock.open.and.returnValue({ afterClosed: () => of(true) });

      component.onSubmit();

      // A single dialog listing all six discrepancies — never one dialog per field.
      expect(dialogMock.open).toHaveBeenCalledTimes(1);
      const data = dialogMock.open.calls.mostRecent().args[1].data as { message: string };
      expect(data.message).toContain('Gewicht 25 g liegt außerhalb');
      expect(data.message).toContain(
        'Federlänge 65 mm liegt außerhalb des erwarteten Bereichs 50,1–57,9 mm (Zaunkönig)',
      );
      expect(data.message).toContain(
        'Flügellänge 90 mm liegt außerhalb des erwarteten Bereichs 68,1–77,9 mm (Zaunkönig)',
      );
      expect(data.message).toContain(
        'Tarsus 25 mm liegt außerhalb des erwarteten Bereichs 17,8–20,2 mm (Zaunkönig)',
      );
      expect(data.message).toContain(
        'Kerbe F2 12 mm liegt außerhalb des erwarteten Bereichs 6,6–9,4 mm (Zaunkönig)',
      );
      expect(data.message).toContain(
        'Innenfuß 20 mm liegt außerhalb des erwarteten Bereichs 13,4–16,6 mm (Zaunkönig)',
      );
      const post = httpMock.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'),
      );
      post.flush({});
    });

    it('renders the inline warnings for the five fields on blur in edit mode too', async () => {
      const routeStub = {
        snapshot: { paramMap: { get: (key: string) => (key === 'id' ? '77' : null) } },
      };
      TestBed.resetTestingModule();
      dialogMock.open.calls.reset();
      await TestBed.configureTestingModule({
        imports: [DataEntryFormComponent],
        providers: [
          provideRouter([]),
          provideHttpClient(),
          provideHttpClientTesting(),
          provideNoopAnimations(),
          { provide: ActivatedRoute, useValue: routeStub },
          { provide: ReferenceBundleCacheService, useValue: cacheStub },
        ],
      })
        .overrideComponent(DataEntryFormComponent, {
          add: { providers: [{ provide: MatDialog, useValue: dialogMock }] },
        })
        .compileComponents();
      const f = TestBed.createComponent(DataEntryFormComponent);
      const editComponent = f.componentInstance;
      const httpMock = TestBed.inject(HttpTestingController);
      f.detectChanges();

      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/data-entries/77/'))
        .flush({
          id: '77',
          species: zaunkoenig,
          ring: { id: 'r1', number: '901234', size: RingSize.S },
          staff: { id: 'p1', handle: 'FRE', full_name: 'Filip Reiter' },
          ringing_station: { handle: 'STAMT', name: 'Linz', organization: project.organization },
          project: null,
          feather_span: 65,
          wing_span: 90,
          tarsus: 25,
          notch_f2: 12,
          inner_foot: 20,
          bird_status: BirdStatus.ReCatch,
          age_class: AgeClass.ThisYear,
          sex: Sex.Female,
          date_time: '2024-05-01T08:30:00Z',
          has_mites: false,
          has_hunger_stripes: false,
          has_brood_patch: false,
          has_cpl_plus: false,
        } as unknown as DataEntry);
      await settle();

      editComponent.onMeasurementBlur();
      f.detectChanges();

      for (const c of fieldCases) {
        const warning = f.nativeElement.querySelector(
          `[data-testid="${c.testid}"]`,
        ) as HTMLElement | null;
        expect(warning).withContext(c.label).not.toBeNull();
        expect(warning!.textContent).toContain(c.message);
      }
    });
  });

  // Issue #248: the Quotient rule surfaced in the capture form. The derived
  // Federlänge/Flügellänge ratio is checked against a relative band; its inline
  // Plausibilitätswarnung sits under its own dedicated slot (keyed by the
  // synthetic `quotient` field so it never collides with the two operands' σ
  // warnings), and it joins the same aggregated save-time confirm-dialog. It
  // recomputes on every operand blur. Create and edit mode.
  describe('Quotient-Plausibilitätswarnung (Artennorm, #248)', () => {
    // Quotient Ø 0,74, Toleranz 3 % → band 0,72–0,76. The σ bands are OFF so the
    // only warning a Quotient case yields is the quotient one.
    const quotientNorm: SpeciesNorm = {
      species_id: 's1',
      species_name: 'Zaunkönig',
      weight_mean: null,
      weight_sd: null,
      feather_mean: null,
      feather_sd: null,
      wing_mean: null,
      wing_sd: null,
      tarsus_mean: null,
      tarsus_sd: null,
      notch_f2_mean: null,
      notch_f2_sd: null,
      inner_foot_mean: null,
      inner_foot_sd: null,
      quotient_mean: '0.74',
      quotient_tolerance_pct: '3',
      sd_factor: '1.96',
      geschlechtsbestimmung_moeglich: null,
      dj_grossgefiedermauser_moeglich: null,
    };
    const zaunkoenig: Species = {
      id: 's1',
      common_name_de: 'Zaunkönig',
      common_name_en: 'Wren',
      scientific_name: 'Troglodytes troglodytes',
      family_name: '',
      order_name: '',
      ring_size: RingSize.V,
      special_kind: '',
    };
    const project = {
      id: 'p1',
      title: 'Herbst',
      description: '',
      show_optional_fields: true,
      organization: { id: 'o1', handle: 'IWM', name: 'IWM Linz', country: 'AT' },
      default_station: null,
      scientists: [],
      created: '',
      updated: '',
    } as Project;
    const bundle: OfflineBundle = {
      identity: { username: 'fre', handle: 'FRE', organization: null, rolle: 'mitglied' },
      species: [],
      ringing_stations: [],
      scientists: [],
      projects: [],
      centrals: [],
      norms: [quotientNorm],
      last_consumed_ring_numbers: [],
    };
    const cacheStub = {
      load: () => Promise.resolve({ bundle, refreshedAt: '2026-07-02T08:00:00.000Z' }),
      save: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    };
    const dialogMock = { open: jasmine.createSpy('open') };
    const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
    const quotientMessage =
      'Quotient Federlänge/Flügellänge 0,86 liegt außerhalb des erwarteten Bereichs 0,72–0,76 (Zaunkönig)';

    async function setup(): Promise<HttpTestingController> {
      TestBed.resetTestingModule();
      dialogMock.open.calls.reset();
      await TestBed.configureTestingModule({
        imports: [DataEntryFormComponent],
        providers: [
          provideRouter([]),
          provideHttpClient(),
          provideHttpClientTesting(),
          provideNoopAnimations(),
          {
            provide: ProjectService,
            useValue: {
              currentProject: signal<Project | null>(project),
              setCurrent: () => {},
              clear: () => {},
            },
          },
          { provide: ReferenceBundleCacheService, useValue: cacheStub },
        ],
      })
        .overrideComponent(DataEntryFormComponent, {
          add: { providers: [{ provide: MatDialog, useValue: dialogMock }] },
        })
        .compileComponents();
      fixture = TestBed.createComponent(DataEntryFormComponent);
      component = fixture.componentInstance;
      const httpMock = TestBed.inject(HttpTestingController);
      fixture.detectChanges();
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/species/'))
        .flush({ count: 0, next: null, previous: null, results: [] });
      await settle();
      return httpMock;
    }

    function fillValid(): void {
      component.entryForm.patchValue({
        ringing_station: { handle: 'STAMT', name: 'Linz' } as never,
        staff: { id: 'p1', handle: 'FRE', full_name: 'Filip Reiter' } as never,
        species: zaunkoenig as never,
        bird_status: BirdStatus.ReCatch,
        ring_size: RingSize.S,
        ring_number: '901234',
      });
      component.selectedSpecies.set(zaunkoenig);
    }

    const warningEl = () =>
      fixture.nativeElement.querySelector(
        '[data-testid="plausibility-quotient-warning"]',
      ) as HTMLElement | null;

    it('renders the inline quotient warning on blur for an out-of-band ratio, with the de-AT message', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);
      component.entryForm.patchValue({ feather_span: 60, wing_span: 70 });
      component.onMeasurementBlur();
      fixture.detectChanges();

      const el = warningEl();
      expect(el).not.toBeNull();
      expect(el!.getAttribute('role')).toBe('alert');
      expect(el!.textContent).toContain(quotientMessage);
    });

    it('renders no inline quotient warning when the ratio is in band', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);
      // 54/73 = 0,7397 — inside 0,72–0,76.
      component.entryForm.patchValue({ feather_span: 54, wing_span: 73 });
      component.onMeasurementBlur();
      fixture.detectChanges();

      expect(warningEl()).toBeNull();
    });

    it('renders no inline quotient warning while either operand is blank (needs both)', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);
      // Only Federlänge — Flügellänge still blank → suppressed.
      component.entryForm.patchValue({ feather_span: 60, wing_span: null });
      component.onMeasurementBlur();
      fixture.detectChanges();

      expect(warningEl()).toBeNull();
    });

    it('recomputes the derived quotient as either operand changes', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);

      // Only Flügellänge present → no warning yet (needs both operands).
      component.entryForm.patchValue({ wing_span: 70 });
      component.onMeasurementBlur();
      fixture.detectChanges();
      expect(warningEl()).toBeNull();

      // Add Federlänge → the now-derivable ratio 60/70 = 0,857 is out of band.
      component.entryForm.patchValue({ feather_span: 60 });
      component.onMeasurementBlur();
      fixture.detectChanges();
      expect(warningEl()).not.toBeNull();
      expect(warningEl()!.textContent).toContain(quotientMessage);

      // Change the other operand so the ratio moves back in band → warning clears.
      // 60/82 = 0,7317 — inside 0,72–0,76.
      component.entryForm.patchValue({ wing_span: 82 });
      component.onMeasurementBlur();
      fixture.detectChanges();
      expect(warningEl()).toBeNull();
    });

    it('includes the quotient discrepancy in the aggregated save-time confirm-dialog and writes on confirm', async () => {
      const httpMock = await setup();
      fillValid();
      component.entryForm.patchValue({ feather_span: 60, wing_span: 70 });
      dialogMock.open.and.returnValue({ afterClosed: () => of(true) });

      component.onSubmit();

      expect(dialogMock.open).toHaveBeenCalledTimes(1);
      const data = dialogMock.open.calls.mostRecent().args[1].data as { message: string };
      expect(data.message).toContain(quotientMessage);
      const post = httpMock.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'),
      );
      post.flush({});
    });

    it('surfaces the inline quotient warning on blur in edit mode too', async () => {
      const routeStub = {
        snapshot: { paramMap: { get: (key: string) => (key === 'id' ? '88' : null) } },
      };
      TestBed.resetTestingModule();
      dialogMock.open.calls.reset();
      await TestBed.configureTestingModule({
        imports: [DataEntryFormComponent],
        providers: [
          provideRouter([]),
          provideHttpClient(),
          provideHttpClientTesting(),
          provideNoopAnimations(),
          { provide: ActivatedRoute, useValue: routeStub },
          { provide: ReferenceBundleCacheService, useValue: cacheStub },
        ],
      })
        .overrideComponent(DataEntryFormComponent, {
          add: { providers: [{ provide: MatDialog, useValue: dialogMock }] },
        })
        .compileComponents();
      const f = TestBed.createComponent(DataEntryFormComponent);
      const editComponent = f.componentInstance;
      const httpMock = TestBed.inject(HttpTestingController);
      f.detectChanges();

      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/data-entries/88/'))
        .flush({
          id: '88',
          species: zaunkoenig,
          ring: { id: 'r1', number: '901234', size: RingSize.S },
          staff: { id: 'p1', handle: 'FRE', full_name: 'Filip Reiter' },
          ringing_station: { handle: 'STAMT', name: 'Linz', organization: project.organization },
          project: null,
          feather_span: 60,
          wing_span: 70,
          bird_status: BirdStatus.ReCatch,
          age_class: AgeClass.ThisYear,
          sex: Sex.Female,
          date_time: '2024-05-01T08:30:00Z',
          has_mites: false,
          has_hunger_stripes: false,
          has_brood_patch: false,
          has_cpl_plus: false,
        } as unknown as DataEntry);
      await settle();

      editComponent.onMeasurementBlur();
      f.detectChanges();

      const warning = f.nativeElement.querySelector(
        '[data-testid="plausibility-quotient-warning"]',
      ) as HTMLElement | null;
      expect(warning).not.toBeNull();
      expect(warning!.textContent).toContain(quotientMessage);
    });
  });
});
