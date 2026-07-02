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
import { ProjectService } from '../service/project.service';
import { Project } from '../models/project.model';
import { RingingStation } from '../models/ringing-station.model';
import { RingSize } from '../models/ring.model';
import { OutboxStoreService } from '../core/offline/outbox-store';
import { OutboxService } from '../service/outbox.service';
import { AuthService } from '../service/auth.service';
import { IndexedDbStore } from '../core/offline/indexed-db-store';

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
});
