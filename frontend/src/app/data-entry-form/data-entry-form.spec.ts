import { signal } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { of } from 'rxjs';

import { DataEntryFormComponent } from './data-entry-form';
import { AgeClass, BirdStatus, DataEntry, Sex } from '../models/data-entry.model';
import { Species } from '../models/species.model';
import { ProjectService } from '../service/project.service';
import { Project } from '../models/project.model';
import { RingingStation } from '../models/ringing-station.model';
import { RingSize } from '../models/ring.model';

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
    it('shows the recapture column set and drops the Station column', () => {
      expect(component.displayedHistoryColumns).toEqual([
        'date_time',
        'species',
        'bird_status',
        'staff',
        'tarsus',
        'feather_span',
        'wing_span',
        'weight_gram',
        'actions',
      ]);
      expect(component.displayedHistoryColumns).not.toContain('ringing_station');
    });

    it('renders Beringer, Tarsus and Federlänge for a Wiederfang row', () => {
      component.recaptureHistory.set([
        {
          date_time: '2024-05-01T08:30:00Z',
          species: { common_name_de: 'Kohlmeise' },
          bird_status: BirdStatus.ReCatch,
          staff: { full_name: 'Filip Reiter' },
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
      expect(cellText('staff')).toBe('Filip Reiter');
      expect(cellText('tarsus')).toBe('19');
      expect(cellText('feather_span')).toBe('54');
      expect(fixture.nativeElement.querySelector('td.mat-column-ringing_station')).toBeNull();
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
      is_sentinel: true,
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

      expect(component.isSentinel()).toBe(true);
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
        ring_size: RingSize.Medium,
        ring_number: '901234',
        bird_status: null,
      });

      // Normal mode: bird_status is required, so the form is invalid.
      expect(form.valid).toBe(false);

      selectSpecies(sentinel);

      expect(form.valid).toBe(true);
    });

    it('keeps the bird fields visible when a normal Art is selected', () => {
      const normal: Species = { ...sentinel, id: 's1', common_name_de: 'Kohlmeise', is_sentinel: false };

      selectSpecies(normal);

      expect(component.isSentinel()).toBe(false);
      expect(has('[formControlName="age_class"]')).toBe(true);
      expect(has('[formControlName="bird_status"]')).toBe(true);
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
      is_sentinel: true,
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
      expect(component.isSentinel()).toBe(true);
    });

    it('leaves the form untouched when the confirmation is cancelled', () => {
      dialogMock.open.and.returnValue({ afterClosed: () => of(false) });

      component.onDestroyedRing();

      expect(dialogMock.open).toHaveBeenCalled();
      expect(component.isSentinel()).toBe(false);
      expect(component.entryForm.get('species')!.value).not.toEqual(sentinel);
    });

    it('renders a discreet quick-button near the Ringnummer field that triggers the flow', () => {
      const button: HTMLButtonElement | null = fixture.nativeElement.querySelector(
        'button[data-testid="destroyed-ring-button"]',
      );
      expect(button).not.toBeNull();

      const spy = spyOn(component, 'onDestroyedRing');
      button!.click();
      expect(spy).toHaveBeenCalled();
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
          ring_size: RingSize.Medium,
        },
        ring: { id: 'r1', number: '901234', size: RingSize.Medium },
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
      expect(form.get('ring_size')!.value).toBe(RingSize.Medium);
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

    it('collapses the form when the loaded entry is a sentinel "Ring Vernichtet"', async () => {
      const { f, httpMock } = await setupEditMode('43');
      f.detectChanges();

      const sentinelEntry = {
        ...savedEntry(),
        id: '43',
        species: { id: 'sent', common_name_de: 'Ring Vernichtet', scientific_name: '', is_sentinel: true },
        bird_status: null,
        age_class: null,
        sex: null,
      } as unknown as DataEntry;
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/data-entries/43/'))
        .flush(sentinelEntry);
      f.detectChanges();

      expect(f.componentInstance.isSentinel()).toBe(true);
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

      const backButton: HTMLButtonElement | null = f.nativeElement.querySelector('.action-buttons button');
      expect(backButton?.textContent?.trim()).toBe('Zur Liste');

      const router = TestBed.inject(Router);
      const navigateSpy = spyOn(router, 'navigateByUrl').and.resolveTo(true);
      f.componentInstance.onBackToList();
      expect(navigateSpy).toHaveBeenCalledWith('/data-entries');
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
        ring_size: RingSize.Medium,
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

    it('lets Enter on the focused save button submit the form (the one allowed case)', () => {
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
        ring_size: RingSize.Medium,
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

  describe('recapture prefill from ring history (#23)', () => {
    let httpMock: HttpTestingController;

    afterEach(() => localStorage.clear());

    beforeEach(async () => {
      httpMock = await setupCreateMode();
    });

    function startWiederfangAndSearch(results: Partial<DataEntry>[]) {
      component.entryForm.patchValue({
        bird_status: BirdStatus.ReCatch,
        ring_size: RingSize.Medium,
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

  describe('CapsLock indicator (#23)', () => {
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
        ring_size: RingSize.Medium,
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
});
