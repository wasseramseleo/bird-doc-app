import { LOCALE_ID, Provider, signal } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { registerLocaleData } from '@angular/common';
import localeDeAt from '@angular/common/locales/de-AT';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { MatDialog } from '@angular/material/dialog';
import { MatSelect } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  MatAutocompleteSelectedEvent,
  MatAutocompleteTrigger,
} from '@angular/material/autocomplete';
import { EMPTY, firstValueFrom, Observable, of, Subject } from 'rxjs';

import { DataEntryFormComponent } from './data-entry-form';
import {
  AgeClass,
  BirdStatus,
  DataEntry,
  HandWingMoult,
  Parasit,
  SelectOption,
  Sex,
  SmallFeatherAppMoult,
  SmallFeatherIntMoult,
} from '../models/data-entry.model';
import { Species } from '../models/species.model';
import { DataAccessFacadeService, RingHistory } from '../service/data-access-facade.service';
import { DataEntryRefreshService } from '../service/data-entry-refresh.service';
import { ProjectService } from '../service/project.service';
import { AUDIO_CONTEXT_FACTORY, SoundService } from '../service/sound.service';
import { WorkbenchStorageService } from '../service/workbench-storage.service';
import { Project, Projekttyp } from '../models/project.model';
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
import { InfoDialogComponent } from '../shared/info-dialog/info-dialog';
import { ConfirmDialogComponent, ConfirmDialogData } from '../shared/confirm-dialog/confirm-dialog';
import { ConnectivityService } from '../core/offline/connectivity';
import { unsavedChangesGuard } from '../core/guards/unsaved-changes.guard';

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
      show_net_fields: true,
      projekttyp: Projekttyp.Sonstiges,
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

  // PRD #361 (#363): the akustisches „Pling" defaults ON, so every
  // warning-producing test below would otherwise construct a REAL AudioContext
  // through the default AUDIO_CONTEXT_FACTORY (`() => new AudioContext()`) via
  // the root SoundService. Mute the cue at the storage layer before EVERY test
  // (playWarning() reads loadSoundEnabled() lazily and returns before touching
  // the factory), so the pre-existing plausibility specs never build one. This
  // is TestBed-independent, so it holds across the per-block resetTestingModule
  // setups. The dedicated #363 block below stays self-contained (spy
  // SoundService / spy factory) and is unaffected. Key mirrors
  // WorkbenchStorageService.SOUND_ENABLED_KEY.
  beforeEach(() => {
    localStorage.setItem('birddoc.soundEnabled', 'false');
  });

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

  // Issue #341: the reusable Zahlenmaske (Eingabefilter) wired onto the capture
  // form — a hard input filter distinct from the value-range Plausibilitätswarnung.
  describe('numeric input masks on the Mess- and Netz-Felder (#341)', () => {
    const MEASUREMENT_FIELDS = [
      'weight_gram',
      'feather_span',
      'wing_span',
      'tarsus',
      'notch_f2',
      'inner_foot',
    ];
    const NET_FIELDS = ['net_location', 'net_height'];

    beforeEach(async () => {
      await setupCreateMode();
    });

    const el = (name: string) =>
      fixture.nativeElement.querySelector(`[formControlName="${name}"]`) as HTMLInputElement;

    // Drive one keystroke through the mask at the given caret position.
    const typeChar = (field: string, char: string, caret?: number): InputEvent => {
      const input = el(field);
      if (caret !== undefined) input.setSelectionRange(caret, caret);
      const event = new InputEvent('beforeinput', {
        data: char,
        inputType: 'insertText',
        cancelable: true,
        bubbles: true,
      });
      input.dispatchEvent(event);
      return event;
    };

    it('carries the one-decimal mask on all six measurement inputs', () => {
      for (const field of MEASUREMENT_FIELDS) {
        expect(el(field).getAttribute('appNumberMask')).toBe('decimal');
      }
    });

    it('carries the integer mask on both Netz-number inputs', () => {
      for (const field of NET_FIELDS) {
        expect(el(field).getAttribute('appNumberMask')).toBe('integer');
      }
    });

    it('rejects a letter typed into a measurement input', () => {
      const event = typeChar('weight_gram', 'a', 0);
      expect(event.defaultPrevented).toBe(true);
    });

    it('rejects a second decimal digit in a measurement input', () => {
      const input = el('tarsus');
      input.value = '12.5';
      const event = typeChar('tarsus', '3', 4);
      expect(event.defaultPrevented).toBe(true);
      expect(input.value).toBe('12.5');
    });

    it('accepts a comma in a measurement input, storing a dot', () => {
      const input = el('weight_gram');
      input.value = '75';
      const event = typeChar('weight_gram', ',', 1);
      expect(event.defaultPrevented).toBe(true);
      expect(input.value).toBe('7.5');
      expect(component.entryForm.get('weight_gram')!.value as unknown).toBe('7.5');
    });

    it('rejects a decimal separator typed into a Netz-number input', () => {
      const input = el('net_location');
      input.value = '12';
      const event = typeChar('net_location', '.', 2);
      expect(event.defaultPrevented).toBe(true);
      expect(input.value).toBe('12');
    });

    it('rejects a comma typed into a Netz-number input', () => {
      const event = typeChar('net_height', ',', 0);
      expect(event.defaultPrevented).toBe(true);
    });
  });

  // Issue #341 regression: with the masked fields now rendered as type="text"
  // (DefaultValueAccessor), clearing a previously-typed value leaves the control
  // holding "" rather than null, and the mask permits an in-progress lone/trailing
  // dot. The write payload must coerce both back to values the backend accepts —
  // DRF's IntegerField 400s on "" and DecimalField 400s on a dangling "." — so a
  // normal correction (type a Netznr., then clear it) still saves.
  describe('normalises masked numeric controls on submit (#341 regression)', () => {
    let httpMock: HttpTestingController;

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

    const submitAndReadBody = (): Record<string, unknown> => {
      component.onSubmit();
      const post = httpMock.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'),
      );
      const body = post.request.body as Record<string, unknown>;
      post.flush({});
      return body;
    };

    it('sends null (not "") for a Netz-number typed then cleared', () => {
      fillValidWiederfang();
      // The DefaultValueAccessor leaves a cleared type="text" input holding "".
      component.entryForm.patchValue({ net_location: '' as never, net_height: '5' as never });

      const body = submitAndReadBody();

      expect(body['net_location']).toBeNull();
      // A still-populated Netz-number rides along untouched (backend coerces).
      expect(body['net_height']).toBe('5');
    });

    it('sends null for a measurement field cleared back to an empty string', () => {
      fillValidWiederfang();
      component.entryForm.patchValue({ weight_gram: '' as never });

      expect(submitAndReadBody()['weight_gram']).toBeNull();
    });

    it('drops a dangling decimal point ("18." → "18", "." → null) before submit', () => {
      fillValidWiederfang();
      component.entryForm.patchValue({ weight_gram: '18.' as never, tarsus: '.' as never });

      const body = submitAndReadBody();

      expect(body['weight_gram']).toBe('18');
      expect(body['tarsus']).toBeNull();
    });
  });

  // #404: the lookup trims, so the write must trim too — otherwise read and write
  // disagree again, one layer down. A foreign Zentrale is the reachable case: it
  // drops the `^[0-9]*$` pattern (#232), so a pasted, whitespace-padded ring
  // actually validates and reaches the payload. A domestic ring is still held to
  // the digits-only pattern, which refuses whitespace with a visible error long
  // before submit — that field stays as strict as it was.
  describe('trims the Ringnummer on the write payload (#404)', () => {
    let httpMock: HttpTestingController;

    const SLOVAK: Central = {
      id: 'c-skb',
      scheme_code: 'SKB',
      name: 'Slowakei Bratislava',
      country: 'Slowakei',
    };

    beforeEach(async () => {
      httpMock = await setupCreateMode();
    });

    function fillForeignWiederfang(ringNumber: string): void {
      component.entryForm.patchValue({
        ringing_station: { handle: 'STAMT', name: 'Linz' } as never,
        staff: { id: 'p1', handle: 'FRE', full_name: 'Filip Reiter' } as never,
        species: { id: 's1', common_name_de: 'Kohlmeise' } as never,
        bird_status: BirdStatus.ReCatch,
      });
      fixture.detectChanges();
      component.entryForm.get('central')!.setValue(SLOVAK as never);
      fixture.detectChanges();
      // A foreign Zentrale's Ringgröße is free text (#232), not an Austrian code.
      component.entryForm.patchValue({ ring_size: 'SKB1' as never, ring_number: ringNumber });
      fixture.detectChanges();
    }

    const submitAndReadBody = (): Record<string, unknown> => {
      component.onSubmit();
      const post = httpMock.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'),
      );
      const body = post.request.body as Record<string, unknown>;
      post.flush({});
      return body;
    };

    it('posts a pasted foreign ring number without its surrounding whitespace', () => {
      fillForeignWiederfang(' AB1234 ');

      expect(submitAndReadBody()['ring_number']).toBe('AB1234');
    });

    it('keeps whitespace inside a foreign ring number on the write payload', () => {
      fillForeignWiederfang(' AB 1234 ');

      expect(submitAndReadBody()['ring_number']).toBe('AB 1234');
    });
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
      show_net_fields: true,
      projekttyp: Projekttyp.Sonstiges,
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

  describe('per-Projekt Netzfelder visibility (#336)', () => {
    const NET_CONTROLS = ['net_location', 'net_height', 'net_direction'];

    const projectWithNet = (show_net_fields: boolean): Project =>
      ({
        id: 'p1',
        title: 'Herbst',
        description: '',
        show_optional_fields: true,
        show_net_fields,
        projekttyp: Projekttyp.Sonstiges,
        organization: { id: 'o1', handle: 'IWM', name: 'IWM Linz', country: 'AT' },
        default_station: null,
        scientists: [],
        created: '',
        updated: '',
      }) as Project;

    async function setupWith(show_net_fields: boolean) {
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
              currentProject: signal<Project | null>(projectWithNet(show_net_fields)),
              setCurrent: () => {},
              clear: () => {},
            },
          },
        ],
      }).compileComponents();
      const f = TestBed.createComponent(DataEntryFormComponent);
      f.detectChanges();
      const httpMock = TestBed.inject(HttpTestingController);
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/species/'))
        .flush({ count: 0, next: null, previous: null, results: [] });
      f.detectChanges();
      return f;
    }

    const netEl = (f: ComponentFixture<DataEntryFormComponent>, name: string) =>
      f.nativeElement.querySelector(`[formControlName="${name}"]`) as HTMLElement | null;

    it('renders the net block and keeps it in the focus order when show_net_fields is true', async () => {
      const f = await setupWith(true);
      const component = f.componentInstance;

      expect(component.showNetFields()).toBe(true);
      for (const name of NET_CONTROLS) {
        expect(netEl(f, name)).not.toBeNull();
        expect(component.entryForm.get(name)!.disabled).toBe(false);
        // The three net controls participate in Tab/Enter/arrow navigation.
        expect((component as unknown as { focusOrder: string[] }).focusOrder).toContain(name);
      }
    });

    it('hides the net block, disables its controls, and drops them from the focus order when show_net_fields is false', async () => {
      const f = await setupWith(false);
      const component = f.componentInstance;

      expect(component.showNetFields()).toBe(false);
      const order = (component as unknown as { focusOrder: string[] }).focusOrder;
      for (const name of NET_CONTROLS) {
        // Absent from the DOM, so focus can never land on a hidden input.
        expect(netEl(f, name)).toBeNull();
        // Disabled so keyboard nav skips them and getRawValue stays inert-but-preserved.
        expect(component.entryForm.get(name)!.disabled).toBe(true);
        // Dropped from the shared focus/arrow order entirely.
        expect(order).not.toContain(name);
      }
      // The fields immediately around the net block still navigate to each other.
      expect(order).toContain('ring_number');
      expect(order).toContain('age_class');
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
        // #405: die frühere 'actions'-Spalte trägt keine Aktion mehr, sondern
        // die drei Marker-Slots — den Detail-Dialog öffnet der Zeilenklick.
        'marker',
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

    // #405 (#374 (#1) abgelöst): der Bemerkungs-Indikator ist jetzt das ⓘ selbst,
    // das nur bei vorhandener Bemerkung rendert — der frühere Badge-Punkt auf dem
    // immer sichtbaren Info-Button ist damit weg. Dasselbe Glyph bedeutet in
    // beiden Tabellen wieder dasselbe: „hat Bemerkung", nicht „hier klicken".
    it('shows the ⓘ only on a past Fang that carries a comment', () => {
      component.recaptureHistory.set([
        historyRow({ comment: 'linker Flügel verletzt' }),
        historyRow({ comment: null }),
      ]);
      fixture.detectChanges();

      const rows = Array.from(
        fixture.nativeElement.querySelectorAll('tr.history-entry'),
      ) as HTMLElement[];
      expect(rows[0].querySelector('[data-testid="bemerkung-icon"]'))
        .withContext('Fang mit Bemerkung trägt das ⓘ')
        .not.toBeNull();
      expect(rows[1].querySelector('[data-testid="bemerkung-icon"]'))
        .withContext('Fang ohne Bemerkung trägt kein ⓘ')
        .toBeNull();
    });

    // #405: beide Fangmarker erzwingen eine Bemerkung — ein ⓘ, das nur
    // "Bemerkung vorhanden" sagt, wäre genau dort redundant; der Tooltip trägt
    // deshalb den echten Text.
    it('shows the actual Bemerkung text on the ⓘ instead of a generic hint', () => {
      component.recaptureHistory.set([historyRow({ comment: 'linker Flügel verletzt' })]);
      fixture.detectChanges();

      const icon = fixture.nativeElement.querySelector(
        '[data-testid="bemerkung-icon"]',
      ) as HTMLElement;
      expect(icon.getAttribute('title')).toBe('linker Flügel verletzt');
      expect(icon.getAttribute('aria-label')).toContain('linker Flügel verletzt');
    });

    // #405: das ⓘ rendert nur, *wenn* eine Bemerkung existiert — ein Badge-Punkt
    // würde bloß die Existenz des Icons wiederholen. Der Badge wechselt den Job
    // und sitzt jetzt an der Überschrift, nicht mehr in der Zeile.
    it('renders the history rows without a badge dot', () => {
      component.recaptureHistory.set([historyRow({ comment: 'linker Flügel verletzt' })]);
      fixture.detectChanges();

      const row = fixture.nativeElement.querySelector('tr.history-entry') as HTMLElement;
      expect(row.querySelector('[data-testid="bemerkung-icon"]')).not.toBeNull();
      expect(row.querySelector('.mat-badge-content')).toBeNull();
      expect(row.querySelector('[matBadge], .mat-badge')).toBeNull();
    });

    // #405 (ADR 0026): ein Fangmarker markiert den Fang, nicht die Art — die
    // Icons leben in der Marker-Spalte, nie in der Art-Zelle. Diese beiden
    // Marker-Icons hatten zuvor null Testabdeckung.
    it('renders the Fangmarker icons in the marker cell and not in the Art cell', () => {
      component.recaptureHistory.set([
        historyRow({
          comment: 'tot unter dem Netz',
          is_dead_recovery: true,
          is_non_standard: true,
        } as Partial<DataEntry>),
      ]);
      fixture.detectChanges();

      const row = fixture.nativeElement.querySelector('tr.history-entry') as HTMLElement;
      const markerCell = row.querySelector('[data-testid="marker-cell"]') as HTMLElement;
      const speciesCell = row.querySelector('td.mat-column-species') as HTMLElement;

      for (const testid of ['bemerkung-icon', 'tot-fund-icon', 'non-standard-icon']) {
        expect(markerCell.querySelector(`[data-testid="${testid}"]`))
          .withContext(`${testid} sitzt in der Marker-Spalte`)
          .not.toBeNull();
      }
      // Die Art-Zelle trägt nur noch den Artnamen.
      expect(speciesCell.textContent).toContain('Kohlmeise');
      expect(speciesCell.querySelector('mat-icon')).toBeNull();
    });

    it('renders a distinct Tot-Fund icon and none on a plain past Fang', () => {
      component.recaptureHistory.set([
        historyRow({}),
        historyRow({ comment: 'tot unter dem Netz', is_dead_recovery: true } as Partial<DataEntry>),
      ]);
      fixture.detectChanges();

      const rows = Array.from(
        fixture.nativeElement.querySelectorAll('tr.history-entry'),
      ) as HTMLElement[];
      expect(rows[0].querySelector('[data-testid="tot-fund-icon"]')).toBeNull();
      expect(rows[1].querySelector('[data-testid="tot-fund-icon"]')).not.toBeNull();
      // Die beiden Fangmarker tragen verschiedene Icons.
      expect(rows[1].querySelector('[data-testid="non-standard-icon"]')).toBeNull();
    });

    it('renders a distinct Nicht-Standard icon', () => {
      component.recaptureHistory.set([
        historyRow({ comment: 'Handfang', is_non_standard: true } as Partial<DataEntry>),
      ]);
      fixture.detectChanges();

      const row = fixture.nativeElement.querySelector('tr.history-entry') as HTMLElement;
      expect(row.querySelector('[data-testid="non-standard-icon"]')).not.toBeNull();
      expect(row.querySelector('[data-testid="tot-fund-icon"]')).toBeNull();
    });

    // #405: die Historie übernimmt die Marker-Konvention aus #388 — drei
    // reservierte Slots in fixer Reihenfolge (ⓘ, ♥, ⚑), damit ein Marker in
    // jeder Zeile im selben Slot sitzt. Geprüft wird die Struktur, nicht die
    // Geometrie: dass die Slots vertikal fluchten, ist eine CSS-Eigenschaft.
    it('reserves three marker slots in fixed order in every history row, occupied or not', () => {
      component.recaptureHistory.set([
        historyRow({}),
        historyRow({ is_non_standard: true } as Partial<DataEntry>),
        historyRow({
          comment: 'tot unter dem Netz',
          is_dead_recovery: true,
          is_non_standard: true,
        } as Partial<DataEntry>),
      ]);
      fixture.detectChanges();

      const rows = Array.from(
        fixture.nativeElement.querySelectorAll('tr.history-entry'),
      ) as HTMLElement[];
      expect(rows.length).toBe(3);
      for (const r of rows) {
        const slots = Array.from(
          r.querySelectorAll('[data-testid="marker-cell"] .marker-slot'),
        ) as HTMLElement[];
        expect(slots.map((s) => s.dataset['testid'])).toEqual([
          'marker-slot-bemerkung',
          'marker-slot-tot-fund',
          'marker-slot-non-standard',
        ]);
      }

      // Ein einzelner Nicht-Standard-Marker bleibt in seinem eigenen Slot; die
      // vorderen Slots bleiben leer und rücken nicht nach.
      const nsSlots = rows[1].querySelectorAll('[data-testid="marker-cell"] .marker-slot');
      expect(nsSlots[0].children.length).toBe(0);
      expect(nsSlots[1].children.length).toBe(0);
      expect(nsSlots[2].querySelector('[data-testid="non-standard-icon"]')).not.toBeNull();

      // Beide Fangmarker plus ⓘ sind gleichzeitig belegbar (ADR 0026).
      const bothSlots = rows[2].querySelectorAll('[data-testid="marker-cell"] .marker-slot');
      expect(bothSlots[0].querySelector('[data-testid="bemerkung-icon"]')).not.toBeNull();
      expect(bothSlots[1].querySelector('[data-testid="tot-fund-icon"]')).not.toBeNull();
      expect(bothSlots[2].querySelector('[data-testid="non-standard-icon"]')).not.toBeNull();
    });

    // #405: das ⓘ ist kein Button mehr — die Zeile trägt die Interaktion, wie in
    // „Letzte Fänge". Sie darf aber *nicht* navigieren: der Beringer ist mitten
    // in einer Erfassung und würde den laufenden Fang verlieren.
    it('opens the detail dialog on a row click without navigating away', () => {
      // MatDialogModule bringt MatDialog als eigenen Provider mit, den die
      // standalone-Komponente in ihrem Node-Injector auflöst — TestBed.inject()
      // liefert eine *andere* Instanz. Der Spy muss auf der Instanz sitzen, die
      // die Komponente tatsächlich benutzt.
      const open = spyOn(fixture.debugElement.injector.get(MatDialog), 'open');
      const router = TestBed.inject(Router);
      const navigate = spyOn(router, 'navigate');
      const navigateByUrl = spyOn(router, 'navigateByUrl');

      const entry = historyRow({ comment: 'linker Flügel verletzt' });
      component.recaptureHistory.set([entry]);
      fixture.detectChanges();

      (fixture.nativeElement.querySelector('tr.history-entry') as HTMLElement).click();
      fixture.detectChanges();

      expect(open).toHaveBeenCalledTimes(1);
      const config = open.calls.mostRecent().args[1] as { data: DataEntry };
      expect(config.data).toBe(entry);

      // Die laufende Erfassung bleibt stehen — kein Routenwechsel.
      expect(navigate).not.toHaveBeenCalled();
      expect(navigateByUrl).not.toHaveBeenCalled();
    });

    // #405: die Anzahl erscheint als hochgestellter Badge, nicht in Klammern.
    it('shows the history count as a superscript badge instead of in brackets', () => {
      component.recaptureHistory.set([historyRow({}), historyRow({}), historyRow({})]);
      fixture.detectChanges();

      const heading = fixture.nativeElement.querySelector(
        '[data-testid="history-heading"]',
      ) as HTMLElement;

      // Die Klammern sind weg; die Zahl sitzt im Badge.
      expect(heading.textContent).not.toContain('(3)');
      const badge = heading.querySelector('.mat-badge-content') as HTMLElement;
      expect(badge).not.toBeNull();
      expect(badge.textContent!.trim()).toBe('3');
    });

    // #405: die Anzahl muss auch WIRKLICH LESBAR sein, nicht nur im textContent
    // stehen. matBadgeSize="small" ist in Material 3 die Punkt-Variante: die Regel
    // `.mat-badge-small .mat-badge-content { font-size: var(--mat-badge-small-size-text-size, 0) }`
    // fällt auf 0 zurück, weil mat.theme() nur --mat-sys-*-Tokens emittiert und
    // --mat-badge-small-size-text-size nirgends definiert ist (nur die alten
    // M2-prebuilt-themes setzen es). Die Ziffer wäre dann zwar im DOM, aber mit
    // font-size: 0 unsichtbar — die Überschrift läse sich als „Bisherige Fänge •".
    // Eine textContent-Assertion kann das nicht sehen, deshalb hier der
    // gerenderte Zustand.
    it('renders the count legibly rather than collapsing it to a dot', () => {
      component.recaptureHistory.set([historyRow({}), historyRow({}), historyRow({})]);
      fixture.detectChanges();

      const badge = fixture.nativeElement.querySelector(
        '[data-testid="history-heading"] .mat-badge-content',
      ) as HTMLElement;

      const fontSize = parseFloat(getComputedStyle(badge).fontSize);
      expect(fontSize).toBeGreaterThan(0);
      // Die Ziffer muss zusätzlich in ihre Box passen: .mat-badge-content trägt
      // overflow: hidden, eine 11px-Ziffer in einer 6px-Zeile wäre abgeschnitten.
      expect(badge.offsetHeight).toBeGreaterThanOrEqual(fontSize);
    });

    // #405: der Badge-Inhalt ist aria-hidden (MatBadge setzt das selbst), ein
    // Screenreader liest ihn also nie. Ohne eigene Beschreibung bliebe die Anzahl
    // für ihn komplett unsichtbar — die Überschrift muss sie selbst tragen.
    it('describes the count for screen readers instead of reading a bare number', () => {
      component.recaptureHistory.set([historyRow({}), historyRow({}), historyRow({})]);
      fixture.detectChanges();

      const heading = fixture.nativeElement.querySelector(
        '[data-testid="history-heading"]',
      ) as HTMLElement;
      expect(heading.querySelector('.mat-badge-content')!.getAttribute('aria-hidden')).toBe('true');
      expect(heading.getAttribute('aria-label')).toBe('Bisherige Fänge, 3 Einträge');
    });

    it('describes a single past Fang in the singular', () => {
      component.recaptureHistory.set([historyRow({})]);
      fixture.detectChanges();

      const heading = fixture.nativeElement.querySelector(
        '[data-testid="history-heading"]',
      ) as HTMLElement;
      expect(heading.getAttribute('aria-label')).toBe('Bisherige Fänge, 1 Eintrag');
    });
  });

  // Issue #374 (#4): the Beringer autocomplete gains autoActiveFirstOption so
  // the highlighted first existing match is committed by the existing Tab-select
  // directive — exactly as the Art field already does. The "➕ Neuer Beringer"
  // create option (value null) must never be auto-committed by Tab; creating a
  // Beringer stays a deliberate click.
  describe('Beringer first-match on Tab (#4)', () => {
    const dialogMock = { open: jasmine.createSpy('open') };
    const emptyPage = { count: 0, next: null, previous: null, results: [] as never[] };
    const scientist = (over: Partial<Scientist> = {}): Scientist =>
      ({ id: '7', handle: 'FRE', full_name: 'Filip Reiter', ...over }) as Scientist;

    let facade: {
      getSpecies: jasmine.Spy;
      getRingingStations: jasmine.Spy;
      getScientists: jasmine.Spy;
      getCentrals: jasmine.Spy;
      getNextRingNumber: jasmine.Spy;
      getRingHistory: jasmine.Spy;
      createScientist: jasmine.Spy;
    };

    beforeEach(async () => {
      TestBed.resetTestingModule();
      dialogMock.open.calls.reset();
      facade = {
        getSpecies: jasmine.createSpy('getSpecies').and.returnValue(of(emptyPage)),
        getRingingStations: jasmine.createSpy('getRingingStations').and.returnValue(of(emptyPage)),
        // A typed term that matches an existing Beringer returns it; anything
        // else returns nothing (so only the create option is offered).
        getScientists: jasmine.createSpy('getScientists').and.callFake((term?: string) =>
          of({
            ...emptyPage,
            results:
              term && 'filip reiter (fre)'.includes(term.toLowerCase()) ? [scientist()] : [],
          }),
        ),
        getCentrals: jasmine.createSpy('getCentrals').and.returnValue(of(emptyPage)),
        getNextRingNumber: jasmine.createSpy('getNextRingNumber').and.returnValue(
          of({ next_number: null }),
        ),
        getRingHistory: jasmine
          .createSpy('getRingHistory')
          .and.returnValue(of({ entries: [], possiblyIncomplete: false })),
        createScientist: jasmine.createSpy('createScientist').and.returnValue(of(scientist())),
      };

      await TestBed.configureTestingModule({
        imports: [DataEntryFormComponent],
        providers: [
          provideRouter([]),
          provideHttpClient(),
          provideHttpClientTesting(),
          provideNoopAnimations(),
          { provide: LOCALE_ID, useValue: 'de-AT' },
          { provide: DataAccessFacadeService, useValue: facade },
          {
            provide: ProjectService,
            useValue: {
              currentProject: signal<Project | null>(createProject()),
              setCurrent: () => {},
              clear: () => {},
            },
          },
        ],
      })
        .overrideComponent(DataEntryFormComponent, {
          add: { providers: [{ provide: MatDialog, useValue: dialogMock }] },
        })
        .compileComponents();

      fixture = TestBed.createComponent(DataEntryFormComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    const staffTrigger = (): MatAutocompleteTrigger =>
      fixture.debugElement
        .query(By.css('input[formControlName="staff"]'))
        .injector.get(MatAutocompleteTrigger);

    const staffInput = (): HTMLInputElement =>
      fixture.nativeElement.querySelector('input[formControlName="staff"]') as HTMLInputElement;

    const pressTab = (): void => {
      staffInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    };

    it('marks the Beringer autocomplete with autoActiveFirstOption, like the Art field', () => {
      expect(staffTrigger().autocomplete.autoActiveFirstOption).toBe(true);
    });

    it('confirms the highlighted first existing match on Tab', () => {
      const match = scientist();
      // Feed the panel a real match (the debounced pipe is bypassed here).
      component.filteredScientists = of([match]);
      fixture.detectChanges();

      const trigger = staffTrigger();
      trigger.openPanel();
      fixture.detectChanges();

      // autoActiveFirstOption highlights the first existing match.
      expect(trigger.activeOption?.value).toEqual(match);

      pressTab();
      fixture.detectChanges();

      expect(component.entryForm.get('staff')!.value).toEqual(match);

      trigger.closePanel();
      fixture.detectChanges();
    });

    it('never commits the "Neuer Beringer" create option on Tab', () => {
      // An unknown Kürzel with no matching Beringer: the only option offered is
      // the "➕ Neuer Beringer" create row, whose value is null.
      const internals = component as unknown as {
        staffSearchTerm: { set(value: string): void };
        staffResults: { set(value: Scientist[]): void };
      };
      internals.staffSearchTerm.set('FREX');
      internals.staffResults.set([]);
      component.filteredScientists = of([]);
      component.entryForm.get('staff')!.setValue('FREX' as never);
      fixture.detectChanges();

      expect(component.showCreateBeringer()).toBe(true);

      const trigger = staffTrigger();
      trigger.openPanel();
      fixture.detectChanges();

      // autoActiveFirstOption highlights the lone create option, whose value is null.
      expect(trigger.activeOption?.value).toBeNull();

      pressTab();
      fixture.detectChanges();

      // The Tab-select guard refuses the create option: the typed text stays,
      // the control is never set to null, and no create dialog is opened.
      expect(component.entryForm.get('staff')!.value as unknown).toBe('FREX');
      expect(dialogMock.open).not.toHaveBeenCalled();

      trigger.closePanel();
      fixture.detectChanges();
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
      show_net_fields: true,
      projekttyp: Projekttyp.Sonstiges,
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

  // #371 (ADR 0026): the two Fangmarker — Tot-Fund and Nicht-Standard-Fang —
  // flag a capture situation WITHOUT replacing the Art or Ring.
  describe('Fangmarker: Tot-Fund & Nicht-Standard-Fang (#371)', () => {
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
      show_net_fields: true,
      projekttyp: Projekttyp.Sonstiges,
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
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/species/'))
        .flush({ count: 1, next: null, previous: null, results: [sentinel] });
    });

    function fillValidCapture(): void {
      component.entryForm.patchValue({
        ringing_station: { handle: 'STAMT', name: 'Linz' } as never,
        staff: { id: 'p1', handle: 'FRE', full_name: 'Filip Reiter' } as never,
        species: { id: 's1', common_name_de: 'Kohlmeise' } as never,
        bird_status: BirdStatus.ReCatch,
        ring_size: RingSize.S,
        ring_number: '901234',
      });
    }

    const btn = (testid: string): HTMLButtonElement | null =>
      fixture.nativeElement.querySelector(`.action-buttons button[data-testid="${testid}"]`);

    it('renders both marker buttons next to "Ring vernichtet", skipped by Tab', () => {
      const tot = btn('tot-fund-button');
      const ns = btn('non-standard-button');
      expect(tot).not.toBeNull();
      expect(ns).not.toBeNull();
      // Skipped by Tab — never in the focus order.
      expect(tot!.getAttribute('tabindex')).toBe('-1');
      expect(ns!.getAttribute('tabindex')).toBe('-1');
    });

    it('hides both marker buttons while Ring vernichtet is active', () => {
      component.onSpeciesSelected({ option: { value: sentinel } } as MatAutocompleteSelectedEvent);
      fixture.detectChanges();

      expect(component.isRingDestroyed()).toBe(true);
      expect(btn('tot-fund-button')).toBeNull();
      expect(btn('non-standard-button')).toBeNull();
    });

    it('forces the markers off when Ring vernichtet becomes active', () => {
      component.entryForm.get('is_dead_recovery')!.setValue(true);
      component.entryForm.get('is_non_standard')!.setValue(true);

      component.onSpeciesSelected({ option: { value: sentinel } } as MatAutocompleteSelectedEvent);
      fixture.detectChanges();

      expect(component.entryForm.get('is_dead_recovery')!.value).toBe(false);
      expect(component.entryForm.get('is_non_standard')!.value).toBe(false);
    });

    it('opens the Tot-Fund popup and composes "Totfund; Umstände: <input>" on confirm', () => {
      dialogMock.open.and.returnValue({ afterClosed: () => of('unter dem Netz gefunden') });

      component.onToggleDeadRecovery();

      expect(dialogMock.open).toHaveBeenCalled();
      expect(component.isDeadRecovery()).toBe(true);
      expect(component.entryForm.get('comment')!.value).toBe('Totfund; Umstände: unter dem Netz gefunden');
    });

    it('leaves the capture un-marked when the Tot-Fund popup is cancelled', () => {
      dialogMock.open.and.returnValue({ afterClosed: () => of(undefined) });

      component.onToggleDeadRecovery();

      expect(component.isDeadRecovery()).toBe(false);
      expect(component.entryForm.get('comment')!.value).toBeNull();
    });

    it('opens the Tot-Fund popup pre-filled by parsing an existing composed Bemerkung', () => {
      component.entryForm.get('comment')!.setValue('Totfund; Umstände: Beifang im Netz');
      dialogMock.open.and.returnValue({ afterClosed: () => of(undefined) });

      component.onToggleDeadRecovery();

      const data = dialogMock.open.calls.mostRecent().args[1]?.data as { umstaende: string };
      expect(data.umstaende).toBe('Beifang im Netz');
    });

    it('toggles the Tot-Fund marker off to undo, clearing the composed Bemerkung', () => {
      component.entryForm.get('is_dead_recovery')!.setValue(true);
      component.entryForm.get('comment')!.setValue('Totfund; Umstände: unter dem Netz');

      component.onToggleDeadRecovery();

      expect(component.isDeadRecovery()).toBe(false);
      expect(component.entryForm.get('comment')!.value).toBeNull();
      // No popup is opened when toggling off.
      expect(dialogMock.open).not.toHaveBeenCalled();
    });

    it('toggles Nicht-Standard on and off without any popup', () => {
      component.onToggleNonStandard();
      expect(component.isNonStandard()).toBe(true);
      expect(dialogMock.open).not.toHaveBeenCalled();

      component.onToggleNonStandard();
      expect(component.isNonStandard()).toBe(false);
    });

    it('shows the coloured frame, badge and a Bemerkung hint for a Nicht-Standard-Fang', () => {
      component.onToggleNonStandard();
      fixture.detectChanges();

      const form = fixture.nativeElement.querySelector('form.data-entry-form') as HTMLElement;
      expect(form.classList).toContain('non-standard-mode');
      expect(fixture.nativeElement.querySelector('[data-testid="non-standard-badge"]')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="non-standard-hint"]')).not.toBeNull();
    });

    it('makes the Bemerkung mandatory while either marker is set', () => {
      const comment = component.entryForm.get('comment')!;
      expect(comment.hasError('required')).toBe(false);

      component.onToggleNonStandard();
      fixture.detectChanges(); // flush the validator-toggling effect
      expect(comment.hasError('required')).toBe(true);

      comment.setValue('Handfang bei einer Vorführung');
      expect(comment.hasError('required')).toBe(false);
    });

    it('carries both markers, set at once, onto the write payload', () => {
      fillValidCapture();
      component.entryForm.get('is_dead_recovery')!.setValue(true);
      component.entryForm.get('is_non_standard')!.setValue(true);
      component.entryForm.get('comment')!.setValue('Totfund; Umstände: außerhalb des Protokolls');

      component.onSubmit();
      const post = httpMock.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'),
      );
      const body = post.request.body as Record<string, unknown>;
      post.flush({});

      expect(body['is_dead_recovery']).toBe(true);
      expect(body['is_non_standard']).toBe(true);
    });
  });

  describe('Aktionszeile: Sonderfall-Knöpfe & Tab-Reihenfolge (#387)', () => {
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
      show_net_fields: true,
      projekttyp: Projekttyp.Sonstiges,
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
        .flush({ count: 1, next: null, previous: null, results: [sentinel] });
    });

    const byTestid = (testid: string): HTMLElement | null =>
      fixture.nativeElement.querySelector(`.action-buttons [data-testid="${testid}"]`);

    const rowButton = (label: string): HTMLButtonElement =>
      (Array.from(fixture.nativeElement.querySelectorAll('.action-buttons button')) as
        HTMLButtonElement[]).find((b) => b.textContent!.trim() === label)!;

    it('groups all three Sonderfall-Knöpfe in one container: Ring vernichtet, Trenner, Tot-Fund, Nicht-Standard-Fang', () => {
      const container = byTestid('special-actions');
      expect(container).not.toBeNull();

      const order = Array.from(container!.children).map((el) => el.getAttribute('data-testid'));
      expect(order).toEqual([
        'destroyed-ring-button',
        'special-actions-separator',
        'tot-fund-button',
        'non-standard-button',
      ]);
    });

    it('keeps the Fangmarker restrained and highlights the active one', () => {
      const tot = byTestid('tot-fund-button')!;
      expect(tot.classList).toContain('fangmarker-link');
      expect(tot.classList).not.toContain('is-active');

      component.entryForm.get('is_dead_recovery')!.setValue(true);
      fixture.detectChanges();

      expect(byTestid('tot-fund-button')!.classList).toContain('is-active');
    });

    it('excludes "Ring vernichtet" and "Zurücksetzen" from the Tab order; only the primary action stays reachable', () => {
      expect(byTestid('destroyed-ring-button')!.getAttribute('tabindex')).toBe('-1');
      expect(byTestid('tot-fund-button')!.getAttribute('tabindex')).toBe('-1');
      expect(byTestid('non-standard-button')!.getAttribute('tabindex')).toBe('-1');
      expect(rowButton('Zurücksetzen').getAttribute('tabindex')).toBe('-1');

      // The primary action ("Erstellen" here, "Änderungen speichern" in edit
      // mode) is the row's only Tab stop — it carries no tabindex at all, so the
      // browser's native order lands on it straight from the Innenfuß.
      const submit = fixture.nativeElement.querySelector(
        '.action-buttons button[type="submit"]',
      ) as HTMLButtonElement;
      expect(submit.textContent!.trim()).toBe('Erstellen');
      expect(submit.getAttribute('tabindex')).toBeNull();
    });

    it('assigns no positive tabindex anywhere in the form', () => {
      const positive = (Array.from(fixture.nativeElement.querySelectorAll('[tabindex]')) as
        HTMLElement[]).filter((el) => Number(el.getAttribute('tabindex')) > 0);

      expect(positive.map((el) => el.getAttribute('data-testid') ?? el.tagName)).toEqual([]);
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
        parasites: [],
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

    // #385: a failed GET used to leave `loading` true forever — the spinner sat
    // over an empty form, the Speichern button stayed disabled via
    // `entryForm.invalid || loading()`, and nothing said why. The GET has no
    // retry: any 5xx / timeout / dropped connection / status 0 (offline) lands
    // here. The error state follows the Fänge-Liste idiom (`error.set(true)` +
    // an inline message) rather than navigating away with a snackbar, which
    // would lose the context of which entry failed.
    it('ends the spinner and shows the error state instead of the form when the GET fails (#385)', async () => {
      const { f, httpMock } = await setupEditMode('42');
      f.detectChanges();

      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/data-entries/42/'))
        .flush('boom', { status: 500, statusText: 'Internal Server Error' });
      f.detectChanges();

      expect(f.componentInstance.loading()).toBe(false);
      expect(f.componentInstance.loadError()).toBe(true);

      const el = f.nativeElement as HTMLElement;
      expect(el.querySelector('[data-testid="load-error"]')).toBeTruthy();
      expect(el.querySelector('mat-spinner')).toBeNull();
      // "instead of the form" — an empty form behind an error message is exactly
      // the dead end #385 reports.
      expect(el.querySelector('form')).toBeNull();
    });

    // #385: „einen Ausweg anbieten" — the error state's only action must actually
    // leave. Without this the state is a nicer-looking dead end.
    it('offers "Zur Liste" as the way out of the failed-load state (#385)', async () => {
      const { f, httpMock } = await setupEditMode('42');
      f.detectChanges();
      const router = TestBed.inject(Router);
      const navigateSpy = spyOn(router, 'navigateByUrl').and.resolveTo(true);

      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/data-entries/42/'))
        .flush('boom', { status: 500, statusText: 'Internal Server Error' });
      f.detectChanges();

      const back = (f.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
        '[data-testid="load-error-back"]',
      );
      back!.click();

      expect(navigateSpy).toHaveBeenCalledWith('/data-entries');
    });

    // #385 explicitly: this is not an offline-only bug, but offline IS one of the
    // two reported reproductions. A dropped connection surfaces as status 0 (the
    // auth interceptor sends `ngsw-bypass` so the SW cannot turn it into a
    // synthetic 504) and must land in the same error state as a 5xx — no
    // offline-only special case.
    it('shows the same error state when the GET fails offline with status 0 (#385)', async () => {
      const { f, httpMock } = await setupEditMode('42');
      f.detectChanges();

      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/data-entries/42/'))
        .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
      f.detectChanges();

      expect(f.componentInstance.loading()).toBe(false);
      expect(f.componentInstance.loadError()).toBe(true);
      expect((f.nativeElement as HTMLElement).querySelector('[data-testid="load-error"]')).toBeTruthy();
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

    it('keeps "Zur Liste" out of the Tab order, leaving "Änderungen speichern" the only Tab stop (#387)', async () => {
      const { f, httpMock } = await setupEditMode('42');
      f.detectChanges();
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/data-entries/42/'))
        .flush(savedEntry());
      f.detectChanges();

      const rowButton = (label: string): HTMLButtonElement =>
        (Array.from(f.nativeElement.querySelectorAll('.action-buttons button')) as
          HTMLButtonElement[]).find((b) => b.textContent!.trim() === label)!;

      expect(rowButton('Zur Liste').getAttribute('tabindex')).toBe('-1');
      expect(rowButton('Zurücksetzen').getAttribute('tabindex')).toBe('-1');
      expect(rowButton('Änderungen speichern').getAttribute('tabindex')).toBeNull();
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

    // #273: opening a saved Wiederfang seeds the "last searched ring" key, so
    // merely leaving the Ringnummer field must not silently re-fetch and clobber
    // in-progress edits; changing the ring still triggers a fresh lookup.
    it('does not re-fetch the ring history when the loaded Ringnummer is left unchanged', async () => {
      const { f, httpMock } = await setupEditMode('42');
      const facade = TestBed.inject(DataAccessFacadeService);
      const spy = spyOn(facade, 'getRingHistory').and.returnValue(
        of<RingHistory>({ entries: [], possiblyIncomplete: false }),
      );
      f.detectChanges();
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/data-entries/42/'))
        .flush(savedEntry());
      f.detectChanges();

      const input = f.nativeElement.querySelector(
        'input[formControlName="ring_number"]',
      ) as HTMLInputElement;
      input.dispatchEvent(new FocusEvent('blur'));
      f.detectChanges();

      expect(spy).not.toHaveBeenCalled();
    });

    it('looks up the ring history when the Ringnummer is changed and then left', async () => {
      const { f, httpMock } = await setupEditMode('42');
      const facade = TestBed.inject(DataAccessFacadeService);
      const spy = spyOn(facade, 'getRingHistory').and.returnValue(
        of<RingHistory>({ entries: [], possiblyIncomplete: false }),
      );
      f.detectChanges();
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/data-entries/42/'))
        .flush(savedEntry());
      f.detectChanges();

      f.componentInstance.entryForm.get('ring_number')!.setValue('901299');
      const input = f.nativeElement.querySelector(
        'input[formControlName="ring_number"]',
      ) as HTMLInputElement;
      input.dispatchEvent(new FocusEvent('blur'));
      f.detectChanges();

      expect(spy).toHaveBeenCalledWith(RingSize.S, '901299');
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
        parasites: [],
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

    // #392 (ADR 0030), Review-Fund: „Eintrag löschen" gehört NICHT in den
    // Queued-Modus. Die Outbox-ID ist lokal vergeben und dem Server unbekannt
    // (sie reist nur als `idempotency_key` mit) — ein DELETE darauf wäre immer
    // ein 404 und damit ein Knopf, der nie funktionieren kann. Besonders
    // greifbar bei einem syncError-Eintrag (#164): der bleibt in der Outbox
    // liegen, damit die Nutzerin ihn öffnen und richtigstellen kann, und ist
    // dabei online — die Offline-Sperre fängt diesen Fall also gerade nicht ab.
    it('does not offer "Eintrag löschen" for a queued entry — its id is local and the server would 404', async () => {
      const { f } = await setupQueuedEditMode('outbox-uuid-1', queuedPayload());
      f.detectChanges();
      await settle();
      f.detectChanges();

      expect(f.componentInstance.isEditMode()).toBe(true);
      expect(f.componentInstance.isQueuedEditMode()).toBe(true);
      // Online — die Offline-Sperre ist hier ausdrücklich nicht die Ursache.
      expect(f.componentInstance.isOffline()).toBe(false);
      expect(
        f.nativeElement.querySelector('.action-buttons button[data-testid="delete-entry-button"]'),
      ).toBeNull();
    });

    it('sends no DELETE for a queued entry even if the delete is invoked directly', async () => {
      const { f, httpMock } = await setupQueuedEditMode('outbox-uuid-1', queuedPayload());
      f.detectChanges();
      await settle();
      f.detectChanges();

      // Eine Bestätigung, die sofort „Löschen" sagt: ohne die Sperre liefe der
      // Aufruf hier ungebremst bis zum DELETE auf die Outbox-ID durch. Die Maske
      // importiert MatDialog selbst — der Spy muss auf ihre EIGENE Instanz.
      const dialog = (f.componentInstance as unknown as { dialog: MatDialog }).dialog;
      const openSpy = spyOn(dialog, 'open').and.returnValue({ afterClosed: () => of(true) } as never);

      f.componentInstance.onDeleteEntry();
      await settle();

      // Es gibt hier nichts zu bestätigen — die Sperre greift vor der Rückfrage.
      expect(openSpy).not.toHaveBeenCalled();
      httpMock.expectNone((r) => r.method === 'DELETE');
      // Der eingereihte Eintrag bleibt, wo er ist — gelöscht wird er auf der
      // Heute-Seite, mit dem Outbox-Mechanismus.
      const stored = await TestBed.inject(OutboxStoreService).listForAccount('fre');
      expect(stored.length).toBe(1);
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

  describe('auto-search the Ringhistorie on Ringnummer blur (#273)', () => {
    const historyRow = (): DataEntry =>
      ({
        id: 'prior-1',
        date_time: '2026-07-01T08:30:00Z',
        species: { id: 's1', common_name_de: 'Kohlmeise' },
        bird_status: BirdStatus.ReCatch,
        staff: { full_name: 'Filip Reiter', handle: 'FRE' },
        age_class: AgeClass.Unknown,
        sex: Sex.Female,
      }) as unknown as DataEntry;

    function spyGetRingHistory(entries: DataEntry[] = [historyRow()]) {
      const facade = TestBed.inject(DataAccessFacadeService);
      return spyOn(facade, 'getRingHistory').and.returnValue(
        of<RingHistory>({ entries, possiblyIncomplete: false }),
      );
    }

    function ringNumberInput(): HTMLInputElement {
      return fixture.nativeElement.querySelector('input[formControlName="ring_number"]');
    }

    function blurRingNumber(relatedTarget: EventTarget | null = null) {
      ringNumberInput().dispatchEvent(new FocusEvent('blur', { relatedTarget }));
      fixture.detectChanges();
    }

    function pressEnterOnRingNumber() {
      ringNumberInput().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
      fixture.detectChanges();
    }

    function enterWiederfangRing(ringNumber = '0043') {
      component.entryForm.patchValue({
        bird_status: BirdStatus.ReCatch,
        ring_size: RingSize.V,
        ring_number: ringNumber,
      });
      fixture.detectChanges();
    }

    it('runs the lookup and shows the history panel when leaving the Ringnummer field on a Wiederfang', () => {
      const spy = spyGetRingHistory();
      enterWiederfangRing();

      blurRingNumber();

      expect(spy).toHaveBeenCalledWith(RingSize.V, '0043');
      expect(component.recaptureHistory().length).toBe(1);
    });

    it('does not look up when leaving the Ringnummer field on an Erstfang', () => {
      const spy = spyGetRingHistory();
      component.entryForm.patchValue({
        bird_status: BirdStatus.FirstCatch,
        ring_size: RingSize.V,
        ring_number: '0043',
      });
      fixture.detectChanges();

      blurRingNumber();

      expect(spy).not.toHaveBeenCalled();
    });

    it('does not look up when the Ringnummer is empty (only a Ringgröße set)', () => {
      const spy = spyGetRingHistory();
      component.entryForm.patchValue({
        bird_status: BirdStatus.ReCatch,
        ring_size: RingSize.V,
        ring_number: '',
      });
      fixture.detectChanges();

      blurRingNumber();

      expect(spy).not.toHaveBeenCalled();
    });

    it('does not re-run the lookup when the field is left twice without changing the ring', () => {
      const spy = spyGetRingHistory();
      enterWiederfangRing();

      blurRingNumber();
      blurRingNumber();

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('runs the lookup once when Enter is pressed and the field is then left unchanged', () => {
      const spy = spyGetRingHistory();
      enterWiederfangRing();

      pressEnterOnRingNumber();
      blurRingNumber();

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('does not fire on blur when focus moves to the search button (the click owns the lookup)', () => {
      const spy = spyGetRingHistory();
      enterWiederfangRing();
      const searchButton = fixture.nativeElement.querySelector(
        'button[aria-label="Ringhistorie suchen"]',
      ) as HTMLButtonElement;
      expect(searchButton).not.toBeNull();

      blurRingNumber(searchButton);

      expect(spy).not.toHaveBeenCalled();
    });

    it('re-runs the lookup on every Enter even when the ring is unchanged (deliberate re-search stays explicit)', () => {
      const spy = spyGetRingHistory();
      enterWiederfangRing();

      pressEnterOnRingNumber();
      pressEnterOnRingNumber();

      expect(spy).toHaveBeenCalledTimes(2);
    });

    // Regression: a reset (as after a save) shifts focus off the Ringnummer,
    // synchronously blurring it while it still holds the just-handled ring. That
    // incidental blur must not auto-search and re-prefill Art over the reset.
    it('does not auto-search when a reset shifts focus off the Ringnummer', () => {
      const spy = spyGetRingHistory();
      enterWiederfangRing();
      ringNumberInput().focus();
      fixture.detectChanges();

      // A pristine form resets straight through cleanReset(), whose focusField
      // ('species') blurs the Ringnummer.
      component.onReset();
      fixture.detectChanges();

      expect(spy).not.toHaveBeenCalled();
      expect(component.entryForm.get('species')!.value).toBeFalsy();
    });
  });

  // #404: DRF trims on write, so a pasted " 901234 " is STORED as "901234".
  // Searching the raw value found nothing and told the Beringer the bird was
  // unknown while it sat in the database. Read and write must trim alike.
  describe('Ringnummer whitespace is trimmed before the lookup (#404)', () => {
    function spyGetRingHistory() {
      const facade = TestBed.inject(DataAccessFacadeService);
      return spyOn(facade, 'getRingHistory').and.returnValue(
        of<RingHistory>({ entries: [], possiblyIncomplete: false }),
      );
    }

    function ringNumberInput(): HTMLInputElement {
      return fixture.nativeElement.querySelector('input[formControlName="ring_number"]');
    }

    function enterWiederfangRing(ringNumber: string, ringSize = RingSize.S) {
      component.entryForm.patchValue({
        bird_status: BirdStatus.ReCatch,
        ring_size: ringSize,
        ring_number: ringNumber,
      });
      fixture.detectChanges();
    }

    it('searches the trimmed ring when the Ringnummer is left with surrounding whitespace', () => {
      const spy = spyGetRingHistory();
      enterWiederfangRing(' 901234 ');

      ringNumberInput().dispatchEvent(new FocusEvent('blur', { relatedTarget: null }));
      fixture.detectChanges();

      expect(spy).toHaveBeenCalledWith(RingSize.S, '901234');
    });

    it('searches the trimmed ring when Enter is pressed (Enter never blurs, so the blur path alone would miss it)', () => {
      const spy = spyGetRingHistory();
      enterWiederfangRing(' 901234 ');

      ringNumberInput().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
      fixture.detectChanges();

      expect(spy).toHaveBeenCalledWith(RingSize.S, '901234');
    });

    it('searches the trimmed ring when the magnifier button is clicked', () => {
      const spy = spyGetRingHistory();
      enterWiederfangRing(' 901234 ');
      const searchButton = fixture.nativeElement.querySelector(
        'button[aria-label="Ringhistorie suchen"]',
      ) as HTMLButtonElement;

      searchButton.click();
      fixture.detectChanges();

      expect(spy).toHaveBeenCalledWith(RingSize.S, '901234');
    });

    it('writes the trimmed value back into the field so the Beringer sees the clean ring', () => {
      spyGetRingHistory();
      enterWiederfangRing(' 901234 ');

      component.fetchRingHistory();
      fixture.detectChanges();

      expect(component.entryForm.get('ring_number')!.value).toBe('901234');
      expect(ringNumberInput().value).toBe('901234');
    });

    it('leaves whitespace INSIDE a foreign ring number untouched ("AB 1234" stays findable)', () => {
      const spy = spyGetRingHistory();
      enterWiederfangRing(' AB 1234 ');

      component.fetchRingHistory();

      // Stripping every space would search "AB1234" and never find the stored
      // "AB 1234" — one failure traded for another.
      expect(spy).toHaveBeenCalledWith(RingSize.S, 'AB 1234');
      expect(component.entryForm.get('ring_number')!.value).toBe('AB 1234');
    });

    it('fires exactly one lookup for Enter followed by Tab on a whitespace-padded ring', () => {
      const spy = spyGetRingHistory();
      enterWiederfangRing(' 901234 ');

      // Enter runs the lookup and writes "901234" back; the Tab-out blur that
      // follows must recognise that ring as already searched. What holds this
      // together is the order inside fetchRingHistory(): the trimmed value is
      // written to the field BEFORE the key is recorded, so the key already
      // describes the rewritten field whichever value ringLookupKey() reads.
      ringNumberInput().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
      fixture.detectChanges();
      ringNumberInput().dispatchEvent(new FocusEvent('blur', { relatedTarget: null }));
      fixture.detectChanges();

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('does not look the same ring up again when whitespace is appended to an already-searched Ringnummer', () => {
      const spy = spyGetRingHistory();
      enterWiederfangRing('901234');

      ringNumberInput().dispatchEvent(new FocusEvent('blur', { relatedTarget: null }));
      fixture.detectChanges();

      // The Beringer returns to the searched field and leaves a trailing space
      // behind. That is the same ring — the lookup would trim it back to
      // "901234" — so the blur must stand down. Without the trim in
      // ringLookupKey() the padded value no longer matches the recorded key and
      // the identical ring is fetched a second time.
      component.entryForm.get('ring_number')!.setValue('901234 ');
      fixture.detectChanges();
      ringNumberInput().dispatchEvent(new FocusEvent('blur', { relatedTarget: null }));
      fixture.detectChanges();

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('does not look up a Ringnummer that is nothing but whitespace', () => {
      const spy = spyGetRingHistory();
      enterWiederfangRing('   ');

      ringNumberInput().dispatchEvent(new FocusEvent('blur', { relatedTarget: null }));
      fixture.detectChanges();

      expect(spy).not.toHaveBeenCalled();
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
      show_net_fields: true,
      projekttyp: Projekttyp.Sonstiges,
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

  // #340/#357: the non-blocking Stundenwechsel-Hinweis. The suggested time snaps to
  // the top of the hour and is re-read from the clock on each save-reset; when that
  // freshly-suggested hour differs from the hour of the entry just saved, a calm
  // full-width top banner (relocated from the Uhrzeit field to below the Caps-Lock
  // warning, #357) with a one-click „auf HH:00 zurück" revert and a ✕ dismiss
  // appears — never a modal, never sticky, never within the same hour.
  describe('Stundenwechsel-Hinweis top banner (#340, #357)', () => {
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

    // Freeze the wall clock the auto-advance reads, so the freshly-suggested
    // top-of-hour is deterministic (each call gets a fresh Date — getInitialDateTime
    // mutates it via setMinutes).
    function freezeClockAt(local: string): void {
      spyOn(component as unknown as { currentDate: () => Date }, 'currentDate').and.callFake(
        () => new Date(local),
      );
    }

    // Save the current form (a valid Wiederfang) and drain the post-save timers so
    // cleanReset() — which raises/clears the hint — has fully run.
    function save(): void {
      component.onSubmit();
      httpMock
        .expectOne((r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'))
        .flush({});
      tick(50);
      fixture.detectChanges();
    }

    it('raises a non-blocking top banner after a save that crossed an hour boundary', fakeAsync(() => {
      // Clock now reads 14:20 → the next suggestion snaps to 14:00, but the bird was
      // still being stamped 13:00 from the previous net-round.
      freezeClockAt('2026-07-04T14:20:00');
      fillValidWiederfang();
      component.entryForm.patchValue({ date_time: '2026-07-04T13:00' });

      save();

      const hint = component.hourChangeHint();
      expect(hint).not.toBeNull();
      expect(hint!.previousDateTime).toBe('2026-07-04T13:00');
      expect(hint!.suggestedDateTime).toBe('2026-07-04T14:00');

      // The note names the new hour; the revert names the previous hour.
      expect(component.hourChangeMessage()).toContain('14:00');
      expect(component.hourChangeRevertLabel()).toBe('auf 13:00 zurück');

      // Surfaced as the top banner in the DOM, and no blocking modal was opened.
      const el = fixture.nativeElement.querySelector('[data-testid="hour-change-hint"]');
      expect(el).not.toBeNull();
      expect(el.textContent).toContain('Stunde gewechselt auf 14:00');

      tick(900);
    }));

    it('opens no modal for the hour-change signal — it is purely non-blocking', fakeAsync(() => {
      const openSpy = spyOn(
        (component as unknown as { dialog: MatDialog }).dialog,
        'open',
      ).and.callThrough();
      freezeClockAt('2026-07-04T14:20:00');
      fillValidWiederfang();
      component.entryForm.patchValue({ date_time: '2026-07-04T13:00' });

      save();

      expect(component.hourChangeHint()).not.toBeNull();
      expect(openSpy).not.toHaveBeenCalled();

      tick(900);
    }));

    it('raises no hint when the suggested hour is unchanged (same-hour save)', fakeAsync(() => {
      // Clock reads 14:20 and the bird was stamped 14:00 — same hour, no signal.
      freezeClockAt('2026-07-04T14:20:00');
      fillValidWiederfang();
      component.entryForm.patchValue({ date_time: '2026-07-04T14:00' });

      save();

      expect(component.hourChangeHint()).toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="hour-change-hint"]')).toBeNull();

      tick(900);
    }));

    it('reverts the time field to the previous hour on a one-click „auf HH:00 zurück"', fakeAsync(() => {
      freezeClockAt('2026-07-04T14:20:00');
      fillValidWiederfang();
      component.entryForm.patchValue({ date_time: '2026-07-04T13:00' });

      save();

      // Post-reset the field auto-advanced to the new hour…
      expect(component.entryForm.get('date_time')!.value).toBe('2026-07-04T14:00');

      // …until the one-click revert writes the previous hour back and clears the hint.
      const revert = fixture.nativeElement.querySelector(
        '[data-testid="hour-change-revert"]',
      ) as HTMLButtonElement;
      revert.click();
      fixture.detectChanges();

      expect(component.entryForm.get('date_time')!.value).toBe('2026-07-04T13:00');
      expect(component.hourChangeHint()).toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="hour-change-hint"]')).toBeNull();

      tick(900);
    }));

    it('is not sticky — a following same-hour save clears the hint and keeps the clock-driven suggestion', fakeAsync(() => {
      freezeClockAt('2026-07-04T14:20:00');
      fillValidWiederfang();
      component.entryForm.patchValue({ date_time: '2026-07-04T13:00' });
      save();
      expect(component.hourChangeHint()).not.toBeNull();
      tick(900);

      // Next capture is saved within the (now current) 14:00 hour — no forced revert
      // to 13:00, the suggestion tracks the clock and the hint is gone.
      fillValidWiederfang();
      expect(component.entryForm.get('date_time')!.value).toBe('2026-07-04T14:00');
      save();

      expect(component.hourChangeHint()).toBeNull();
      expect(component.entryForm.get('date_time')!.value).toBe('2026-07-04T14:00');

      tick(900);
    }));

    // #357: the hint moved to a full-width top banner and gained a ✕ dismiss that
    // accepts the new hour — it clears the hint but, unlike the revert, leaves the
    // clock-driven time untouched.
    it('dismisses the hint without changing the time via the ✕ dismiss control', fakeAsync(() => {
      freezeClockAt('2026-07-04T14:20:00');
      fillValidWiederfang();
      component.entryForm.patchValue({ date_time: '2026-07-04T13:00' });

      save();

      // The field auto-advanced to the new hour and the hint is up.
      expect(component.entryForm.get('date_time')!.value).toBe('2026-07-04T14:00');
      expect(component.hourChangeHint()).not.toBeNull();

      const dismiss = fixture.nativeElement.querySelector(
        '[data-testid="hour-change-dismiss"]',
      ) as HTMLButtonElement;
      dismiss.click();
      fixture.detectChanges();

      // Hint gone, but the new hour is kept (accepted) — not reverted to 13:00.
      expect(component.hourChangeHint()).toBeNull();
      expect(component.entryForm.get('date_time')!.value).toBe('2026-07-04T14:00');
      expect(fixture.nativeElement.querySelector('[data-testid="hour-change-hint"]')).toBeNull();

      tick(900);
    }));

    // #357: the hint is a top-of-form banner, no longer nested under the Uhrzeit field.
    it('renders the hint as a top-of-form banner, not inside a form-section', fakeAsync(() => {
      freezeClockAt('2026-07-04T14:20:00');
      fillValidWiederfang();
      component.entryForm.patchValue({ date_time: '2026-07-04T13:00' });

      save();

      const banner = fixture.nativeElement.querySelector('[data-testid="hour-change-hint"]');
      expect(banner).not.toBeNull();
      // Relocated out of the datetime field's .form-section to the top of the form.
      expect(banner.closest('.form-section')).toBeNull();
      expect(banner.closest('form.data-entry-form')).not.toBeNull();

      tick(900);
    }));

    // #357: the two banners are independent — when Caps-Lock is on AND an hour change
    // is pending, both show, stacked with Caps-Lock above the hour-change banner.
    it('stacks both banners with Caps-Lock above when both conditions hold', fakeAsync(() => {
      freezeClockAt('2026-07-04T14:20:00');
      fillValidWiederfang();
      component.entryForm.patchValue({ date_time: '2026-07-04T13:00' });

      save();

      // Turn Caps-Lock on via a keystroke that reports the modifier active.
      component.onKeydown({
        key: 'a',
        getModifierState: (m: string) => m === 'CapsLock',
        preventDefault: () => {},
      } as unknown as KeyboardEvent);
      fixture.detectChanges();

      const caps = fixture.nativeElement.querySelector('[data-testid="capslock-hint"]');
      const hint = fixture.nativeElement.querySelector('[data-testid="hour-change-hint"]');
      expect(caps).not.toBeNull();
      expect(hint).not.toBeNull();

      // Caps-Lock banner precedes the hour-change banner in document order.
      expect(caps.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      tick(900);
    }));
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

    // #404: a capture queued offline is the bug seen from the other side —
    // assembleLocalRingHistory matches the outbox payload with a strict ===, so a
    // raw ring number in the queue is invisible to the next Wiederfang on the very
    // device that recorded it. A foreign Zentrale is the reachable case (it drops
    // the digits-only pattern, so a pasted ring validates).
    it('enqueues an offline foreign capture under its trimmed ring number, so the later Wiederfang finds it', async () => {
      const outboxStore = TestBed.inject(OutboxStoreService);
      component.entryForm.patchValue({
        ringing_station: { handle: 'STAMT', name: 'Linz' } as never,
        staff: { id: 'p1', handle: 'FRE', full_name: 'Filip Reiter' } as never,
        species: { id: 's1', common_name_de: 'Kohlmeise' } as never,
        bird_status: BirdStatus.ReCatch,
      });
      fixture.detectChanges();
      component.entryForm.get('central')!.setValue({
        id: 'c-skb',
        scheme_code: 'SKB',
        name: 'Slowakei Bratislava',
        country: 'Slowakei',
      } as never);
      fixture.detectChanges();
      component.entryForm.patchValue({ ring_size: 'SKB1' as never, ring_number: ' AB1234 ' });
      fixture.detectChanges();

      component.onSubmit();
      respondOffline();
      await waitUntil(() => component.entryForm.get('species')!.value === null);

      const entries = await outboxStore.list();
      expect(entries.length).toBe(1);
      expect((entries[0].payload as {ring_number?: string}).ring_number).toBe('AB1234');
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
        parasites: [],
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
      show_net_fields: true,
      projekttyp: Projekttyp.Sonstiges,
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

    // #265: the verbose inline div is replaced by a quiet warning suffix icon
    // whose de-AT message rides its hover `title`.
    const warningEl = () =>
      fixture.nativeElement.querySelector(
        '[data-testid="plausibility-weight_gram-icon"]',
      ) as HTMLElement | null;

    it('shows the quiet warning suffix icon on blur for an out-of-range Gewicht, carrying the de-AT message', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);
      component.entryForm.get('weight_gram')!.setValue(25);
      component.onMeasurementBlur();
      fixture.detectChanges();

      const el = warningEl();
      expect(el).not.toBeNull();
      expect(el!.getAttribute('title')).toContain(
        'Gewicht 25 g liegt außerhalb des erwarteten Bereichs 7,5–10,7 g (Zaunkönig)',
      );
    });

    // #338: a blur fires the check, so the field has already lost focus by the
    // time the informational „Verstanden" modal opens. Once acknowledged, focus
    // must land back on the field that triggered the warning so the flagged value
    // can be re-examined or retyped straight away — a deliberate backward jump.
    it('returns focus to the checked field after the „Verstanden" dialog closes', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);
      dialogMock.open.and.returnValue({ afterClosed: () => of(true) });
      component.entryForm.get('weight_gram')!.setValue(25);
      fixture.detectChanges();

      // Nothing is focused after the blur (the field lost focus already).
      const weight = fixture.nativeElement.querySelector('[formControlName="weight_gram"]');
      expect(document.activeElement).not.toBe(weight);

      component.onMeasurementBlur('weight_gram');
      fixture.detectChanges();

      expect(dialogMock.open).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(weight);
    });

    it('does not steal focus when the blurred value is in range (no dialog)', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);
      dialogMock.open.and.returnValue({ afterClosed: () => of(true) });
      component.entryForm.get('weight_gram')!.setValue(9);
      fixture.detectChanges();

      component.onMeasurementBlur('weight_gram');
      fixture.detectChanges();

      const weight = fixture.nativeElement.querySelector('[formControlName="weight_gram"]');
      expect(dialogMock.open).not.toHaveBeenCalled();
      expect(document.activeElement).not.toBe(weight);
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

    // #266: the save-time gate is gone — onSubmit opens NO plausibility dialog and
    // writes directly even with an active Warnung (the modal already fired on blur).
    it('opens no plausibility dialog on submit and writes directly with an active warning', async () => {
      const httpMock = await setup();
      fillValid();
      component.entryForm.get('weight_gram')!.setValue(25);

      component.onSubmit();

      expect(dialogMock.open).not.toHaveBeenCalled();
      const post = httpMock.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'),
      );
      post.flush({});
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

    it('opens no plausibility dialog on submit in edit mode and writes directly (gate removed)', async () => {
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
          parasites: [],
          has_hunger_stripes: false,
          has_brood_patch: false,
          has_cpl_plus: false,
        } as unknown as DataEntry);
      await settle();

      f.componentInstance.onSubmit();

      expect(dialogMock.open).not.toHaveBeenCalled();
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
        testid: 'plausibility-feather_span-icon',
        inRange: 54,
        outOfRange: 65,
        message:
          'Federlänge 65 mm liegt außerhalb des erwarteten Bereichs 50,1–57,9 mm (Zaunkönig)',
      },
      {
        label: 'Flügellänge',
        field: 'wing_span',
        testid: 'plausibility-wing_span-icon',
        inRange: 73,
        outOfRange: 90,
        message:
          'Flügellänge 90 mm liegt außerhalb des erwarteten Bereichs 68,1–77,9 mm (Zaunkönig)',
      },
      {
        label: 'Tarsus',
        field: 'tarsus',
        testid: 'plausibility-tarsus-icon',
        inRange: 19,
        outOfRange: 25,
        message: 'Tarsus 25 mm liegt außerhalb des erwarteten Bereichs 17,8–20,2 mm (Zaunkönig)',
      },
      {
        label: 'Kerbe F2',
        field: 'notch_f2',
        testid: 'plausibility-notch_f2-icon',
        inRange: 8,
        outOfRange: 12,
        message: 'Kerbe F2 12 mm liegt außerhalb des erwarteten Bereichs 6,6–9,4 mm (Zaunkönig)',
      },
      {
        label: 'Innenfuß',
        field: 'inner_foot',
        testid: 'plausibility-inner_foot-icon',
        inRange: 15,
        outOfRange: 20,
        message: 'Innenfuß 20 mm liegt außerhalb des erwarteten Bereichs 13,4–16,6 mm (Zaunkönig)',
      },
    ];

    for (const c of fieldCases) {
      describe(`suffix icon under ${c.label} (#247/#265)`, () => {
        const el = () =>
          fixture.nativeElement.querySelector(
            `[data-testid="${c.testid}"]`,
          ) as HTMLElement | null;

        it('shows the quiet suffix icon on blur for an out-of-range value, carrying the de-AT message', async () => {
          await setup();
          component.selectedSpecies.set(zaunkoenig);
          component.entryForm.get(c.field)!.setValue(c.outOfRange);
          component.onMeasurementBlur();
          fixture.detectChanges();

          const warning = el();
          expect(warning).not.toBeNull();
          expect(warning!.getAttribute('title')).toContain(c.message);
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

    // #266: with several fields out of range the save is still never gated —
    // onSubmit opens no plausibility dialog and writes directly.
    it('opens no plausibility dialog on submit and writes directly even with several out-of-range measurements', async () => {
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

      component.onSubmit();

      expect(dialogMock.open).not.toHaveBeenCalled();
      const post = httpMock.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'),
      );
      post.flush({});
    });

    it('shows the suffix icons for the five fields on blur in edit mode too', async () => {
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
          parasites: [],
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
        expect(warning!.getAttribute('title')).toContain(c.message);
      }
    });
  });

  // PRD #361, issue #363: the akustisches „Pling" is bound to the SAME reconcile
  // event that opens the „Verstanden" modal — the moment a warning is decided to
  // have newly appeared. So the form must call SoundService.playWarning() exactly
  // once per newly-appeared warning, stay silent on the edit-load/seed path (which
  // raises no modal), and never let a muted/absent cue disturb the visual check.
  describe('akustisches Pling bei neuer Plausibilitätswarnung (#363)', () => {
    const norm: SpeciesNorm = {
      species_id: 's1',
      species_name: 'Zaunkönig',
      weight_mean: '9.1',
      weight_sd: '0.82',
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
    const project = {
      id: 'p1',
      title: 'Herbst',
      description: '',
      show_optional_fields: true,
      show_net_fields: true,
      projekttyp: Projekttyp.Sonstiges,
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
    const sound = { playWarning: jasmine.createSpy('playWarning') };
    const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

    afterEach(() => localStorage.clear());

    async function setupCreate(): Promise<HttpTestingController> {
      TestBed.resetTestingModule();
      dialogMock.open.calls.reset();
      sound.playWarning.calls.reset();
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
          add: {
            providers: [
              { provide: MatDialog, useValue: dialogMock },
              { provide: SoundService, useValue: sound },
            ],
          },
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

    it('plays the Pling exactly once when a new implausible value produces a warning', async () => {
      await setupCreate();
      component.selectedSpecies.set(zaunkoenig);
      component.entryForm.get('weight_gram')!.setValue(25);

      component.onMeasurementBlur('weight_gram');

      expect(sound.playWarning).toHaveBeenCalledTimes(1);
      // The cue rides the same event as the modal (a non-Geschlecht warning here).
      expect(dialogMock.open).toHaveBeenCalledTimes(1);
    });

    it('re-alerts when an already-flagged value changes to a different implausible value', async () => {
      await setupCreate();
      component.selectedSpecies.set(zaunkoenig);
      component.entryForm.get('weight_gram')!.setValue(25);
      component.onMeasurementBlur('weight_gram');
      expect(sound.playWarning).toHaveBeenCalledTimes(1);

      // A second, *different* out-of-range value is a fresh newly-appeared warning.
      component.entryForm.get('weight_gram')!.setValue(30);
      component.onMeasurementBlur('weight_gram');

      expect(sound.playWarning).toHaveBeenCalledTimes(2);
    });

    it('does not re-play when the same flagged value is re-triggered unchanged', async () => {
      await setupCreate();
      component.selectedSpecies.set(zaunkoenig);
      component.entryForm.get('weight_gram')!.setValue(25);
      component.onMeasurementBlur('weight_gram');

      // Same value, blurred again: already acknowledged → no fresh warning, no Pling.
      component.onMeasurementBlur('weight_gram');

      expect(sound.playWarning).toHaveBeenCalledTimes(1);
    });

    it('stays silent on the edit-load/seed path (an existing warning raises no Pling)', async () => {
      const routeStub = {
        snapshot: { paramMap: { get: (key: string) => (key === 'id' ? '77' : null) } },
      };
      TestBed.resetTestingModule();
      dialogMock.open.calls.reset();
      sound.playWarning.calls.reset();
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
          add: {
            providers: [
              { provide: MatDialog, useValue: dialogMock },
              { provide: SoundService, useValue: sound },
            ],
          },
        })
        .compileComponents();
      const f = TestBed.createComponent(DataEntryFormComponent);
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
          weight_gram: 25,
          bird_status: BirdStatus.ReCatch,
          age_class: AgeClass.ThisYear,
          sex: Sex.Female,
          date_time: '2024-05-01T08:30:00Z',
          parasites: [],
          has_hunger_stripes: false,
          has_brood_patch: false,
          has_cpl_plus: false,
        } as unknown as DataEntry);
      await settle();

      // The stored value already breaches (icon is active) but the load raises no
      // modal — and so no Pling.
      expect(sound.playWarning).not.toHaveBeenCalled();
      expect(dialogMock.open).not.toHaveBeenCalled();
    });

    it('keeps the visual safety check intact when muted (modal opens, no audio synthesized)', async () => {
      // Real SoundService this time, with a spy AudioContext factory: muting must
      // make playWarning a no-op (factory never called) WITHOUT suppressing the
      // modal — audio muted/unavailable never costs the visual check.
      const audioFactory = jasmine.createSpy('audioContextFactory');
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
          { provide: AUDIO_CONTEXT_FACTORY, useValue: audioFactory },
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
      TestBed.inject(WorkbenchStorageService).saveSoundEnabled(false);

      component.selectedSpecies.set(zaunkoenig);
      component.entryForm.get('weight_gram')!.setValue(25);
      component.onMeasurementBlur('weight_gram');

      expect(dialogMock.open).toHaveBeenCalledTimes(1);
      expect(audioFactory).not.toHaveBeenCalled();
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
      show_net_fields: true,
      projekttyp: Projekttyp.Sonstiges,
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

    // #265: the Quotient has no field of its own, so a breach marks the quiet
    // suffix icon on BOTH operands (Federlänge and Flügellänge); its message
    // rides each icon's hover `title`.
    const featherIcon = () =>
      fixture.nativeElement.querySelector(
        '[data-testid="plausibility-feather_span-icon"]',
      ) as HTMLElement | null;
    const wingIcon = () =>
      fixture.nativeElement.querySelector(
        '[data-testid="plausibility-wing_span-icon"]',
      ) as HTMLElement | null;

    it('marks BOTH operand suffix icons on blur for an out-of-band ratio, carrying the de-AT message', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);
      component.entryForm.patchValue({ feather_span: 60, wing_span: 70 });
      component.onMeasurementBlur();
      fixture.detectChanges();

      expect(featherIcon()).not.toBeNull();
      expect(wingIcon()).not.toBeNull();
      expect(featherIcon()!.getAttribute('title')).toContain(quotientMessage);
      expect(wingIcon()!.getAttribute('title')).toContain(quotientMessage);
    });

    it('marks no operand suffix icon when the ratio is in band', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);
      // 54/73 = 0,7397 — inside 0,72–0,76.
      component.entryForm.patchValue({ feather_span: 54, wing_span: 73 });
      component.onMeasurementBlur();
      fixture.detectChanges();

      expect(featherIcon()).toBeNull();
      expect(wingIcon()).toBeNull();
    });

    it('marks no operand suffix icon while either operand is blank (needs both)', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);
      // Only Federlänge — Flügellänge still blank → suppressed.
      component.entryForm.patchValue({ feather_span: 60, wing_span: null });
      component.onMeasurementBlur();
      fixture.detectChanges();

      expect(featherIcon()).toBeNull();
      expect(wingIcon()).toBeNull();
    });

    it('recomputes the derived quotient as either operand changes', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);

      // Only Flügellänge present → no warning yet (needs both operands).
      component.entryForm.patchValue({ wing_span: 70 });
      component.onMeasurementBlur();
      fixture.detectChanges();
      expect(featherIcon()).toBeNull();
      expect(wingIcon()).toBeNull();

      // Add Federlänge → the now-derivable ratio 60/70 = 0,857 is out of band.
      component.entryForm.patchValue({ feather_span: 60 });
      component.onMeasurementBlur();
      fixture.detectChanges();
      expect(featherIcon()).not.toBeNull();
      expect(wingIcon()).not.toBeNull();
      expect(featherIcon()!.getAttribute('title')).toContain(quotientMessage);

      // Change the other operand so the ratio moves back in band → warning clears.
      // 60/82 = 0,7317 — inside 0,72–0,76.
      component.entryForm.patchValue({ wing_span: 82 });
      component.onMeasurementBlur();
      fixture.detectChanges();
      expect(featherIcon()).toBeNull();
      expect(wingIcon()).toBeNull();
    });

    // #266: the save-time gate is gone — an active Quotient warning does not gate
    // the save; onSubmit opens no plausibility dialog and writes directly.
    it('opens no plausibility dialog on submit and writes directly with an active Quotient warning', async () => {
      const httpMock = await setup();
      fillValid();
      component.entryForm.patchValue({ feather_span: 60, wing_span: 70 });

      component.onSubmit();

      expect(dialogMock.open).not.toHaveBeenCalled();
      const post = httpMock.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'),
      );
      post.flush({});
    });

    it('marks both operand suffix icons for a Quotient breach on blur in edit mode too', async () => {
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
          parasites: [],
          has_hunger_stripes: false,
          has_brood_patch: false,
          has_cpl_plus: false,
        } as unknown as DataEntry);
      await settle();

      editComponent.onMeasurementBlur();
      f.detectChanges();

      const featherWarning = f.nativeElement.querySelector(
        '[data-testid="plausibility-feather_span-icon"]',
      ) as HTMLElement | null;
      const wingWarning = f.nativeElement.querySelector(
        '[data-testid="plausibility-wing_span-icon"]',
      ) as HTMLElement | null;
      expect(featherWarning).not.toBeNull();
      expect(wingWarning).not.toBeNull();
      expect(featherWarning!.getAttribute('title')).toContain(quotientMessage);
    });
  });

  // Issue #249 (UX per #266): the two categorical-flag rules surfaced in the
  // capture form. A determined Geschlecht against a not-sexable Artennorm, and a
  // Handschwingenmauser on a diesjährigen Vogel against a no-dj-moult Artennorm,
  // each mark a quiet suffix icon under their own field (`sex` / `hand_wing`) — the
  // #266 UX — and the save is never gated. The flag selects settle on
  // selectionChange (onCategoricalChange), not an input blur. Create and edit mode.
  describe('kategorische Flag-Plausibilitätswarnungen (Artennorm, #249)', () => {
    // A Zaunkönig norm with ONLY the two categorical flags armed (all seven
    // numeric rules off), so a flag case yields at most its own flag warning.
    const flagNorm: SpeciesNorm = {
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
      quotient_mean: null,
      quotient_tolerance_pct: null,
      sd_factor: '1.96',
      geschlechtsbestimmung_moeglich: false,
      dj_grossgefiedermauser_moeglich: false,
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
      show_net_fields: true,
      projekttyp: Projekttyp.Sonstiges,
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
      norms: [flagNorm],
      last_consumed_ring_numbers: [],
    };
    const cacheStub = {
      load: () => Promise.resolve({ bundle, refreshedAt: '2026-07-02T08:00:00.000Z' }),
      save: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    };
    const dialogMock = { open: jasmine.createSpy('open') };
    const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
    const sexMessage = 'Geschlechtsbestimmung laut Artennorm nicht möglich (Zaunkönig)';
    const handWingMessage =
      'Großgefiedermauser bei diesjährigem Vogel laut Artennorm nicht zu erwarten (Zaunkönig)';

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

    const sexIcon = () =>
      fixture.nativeElement.querySelector(
        '[data-testid="plausibility-sex-icon"]',
      ) as HTMLElement | null;
    const handWingIcon = () =>
      fixture.nativeElement.querySelector(
        '[data-testid="plausibility-hand_wing-icon"]',
      ) as HTMLElement | null;

    it('marks the Geschlecht suffix icon when a determined sex is picked against a not-sexable norm', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);
      component.entryForm.get('sex')!.setValue(Sex.Male);
      component.onCategoricalChange();
      fixture.detectChanges();

      const el = sexIcon();
      expect(el).not.toBeNull();
      expect(el!.getAttribute('title')).toContain(sexMessage);
    });

    it('marks no Geschlecht suffix icon for Unbekannt (fires on a claim, not an absence)', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);
      component.entryForm.get('sex')!.setValue(Sex.Unknown);
      component.onCategoricalChange();
      fixture.detectChanges();

      expect(sexIcon()).toBeNull();
    });

    it('marks the Handschwingenmauser suffix icon for a diesjährigen Vogel with moult present', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);
      component.entryForm.patchValue({
        age_class: AgeClass.ThisYear,
        hand_wing: HandWingMoult.AtLeastOne,
      });
      component.onCategoricalChange();
      fixture.detectChanges();

      const el = handWingIcon();
      expect(el).not.toBeNull();
      expect(el!.getAttribute('title')).toContain(handWingMessage);
    });

    it('marks no Handschwingenmauser suffix icon when the bird is not diesjährig', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);
      component.entryForm.patchValue({
        age_class: AgeClass.NotThisYear,
        hand_wing: HandWingMoult.AtLeastOne,
      });
      component.onCategoricalChange();
      fixture.detectChanges();

      expect(handWingIcon()).toBeNull();
    });

    it('marks neither flag suffix icon when the selected Art carries no Artennorm', async () => {
      await setup();
      component.selectedSpecies.set({ ...zaunkoenig, id: 's2', common_name_de: 'Kohlmeise' });
      component.entryForm.patchValue({
        sex: Sex.Male,
        age_class: AgeClass.ThisYear,
        hand_wing: HandWingMoult.AtLeastOne,
      });
      component.onCategoricalChange();
      fixture.detectChanges();

      expect(sexIcon()).toBeNull();
      expect(handWingIcon()).toBeNull();
    });

    // #266: the save-time gate is gone — active flag warnings do not gate the save.
    it('opens no plausibility dialog on submit and writes directly with both flag warnings active', async () => {
      const httpMock = await setup();
      fillValid();
      component.entryForm.patchValue({
        sex: Sex.Male,
        age_class: AgeClass.ThisYear,
        hand_wing: HandWingMoult.AtLeastOne,
      });

      component.onSubmit();

      expect(dialogMock.open).not.toHaveBeenCalled();
      const post = httpMock.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'),
      );
      post.flush({});
    });

    it('marks both flag suffix icons in edit mode too', async () => {
      const routeStub = {
        snapshot: { paramMap: { get: (key: string) => (key === 'id' ? '99' : null) } },
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
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/data-entries/99/'))
        .flush({
          id: '99',
          species: zaunkoenig,
          ring: { id: 'r1', number: '901234', size: RingSize.S },
          staff: { id: 'p1', handle: 'FRE', full_name: 'Filip Reiter' },
          ringing_station: { handle: 'STAMT', name: 'Linz', organization: project.organization },
          project: null,
          bird_status: BirdStatus.ReCatch,
          age_class: AgeClass.ThisYear,
          sex: Sex.Male,
          hand_wing: HandWingMoult.AtLeastOne,
          date_time: '2024-05-01T08:30:00Z',
          parasites: [],
          has_hunger_stripes: false,
          has_brood_patch: false,
          has_cpl_plus: false,
        } as unknown as DataEntry);
      await settle();

      editComponent.onCategoricalChange();
      f.detectChanges();

      const sexWarning = f.nativeElement.querySelector(
        '[data-testid="plausibility-sex-icon"]',
      ) as HTMLElement | null;
      const handWingWarning = f.nativeElement.querySelector(
        '[data-testid="plausibility-hand_wing-icon"]',
      ) as HTMLElement | null;
      expect(sexWarning).not.toBeNull();
      expect(sexWarning!.getAttribute('title')).toContain(sexMessage);
      expect(handWingWarning).not.toBeNull();
      expect(handWingWarning!.getAttribute('title')).toContain(handWingMessage);
    });
  });

  // Issue #265 (PRD #261): the numeric Plausibilitäts-UX redesign. Leaving a
  // measurement field whose value NEWLY breaches its Artennorm raises the single-
  // „Verstanden" InfoDialog (#263), routed through the „fire once, never nag"
  // de-dup (#264) so an acknowledged value never nags again, and one blur
  // tripping several checks yields ONE aggregated modal. The verbose inline
  // numeric hint is replaced by a quiet warning suffix icon that persists after
  // the modal is dismissed. An Art change wipes the acknowledgment and re-checks
  // every numeric field against the new norm. Numeric path only — the categorical
  // sex/hand_wing modal is #266, and the save-time confirm-dialog gate stays.
  describe('Plausibilitäts-Modal beim Auftreten + Suffix-Icon (numeric, #265)', () => {
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
      quotient_mean: '0.74',
      quotient_tolerance_pct: '3',
      sd_factor: '1.96',
      geschlechtsbestimmung_moeglich: null,
      dj_grossgefiedermauser_moeglich: null,
    };
    // A second normed Art so an Art change re-checks against a DIFFERENT norm:
    // 25 g is out of Kohlmeise's 15–19 g band too. Its Quotient rule is off.
    const kohlmeiseNorm: SpeciesNorm = {
      ...norm,
      species_id: 's2',
      species_name: 'Kohlmeise',
      weight_mean: '17',
      weight_sd: '1',
      quotient_mean: null,
      quotient_tolerance_pct: null,
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
    const kohlmeise: Species = { ...zaunkoenig, id: 's2', common_name_de: 'Kohlmeise' };
    const unnormedSpecies: Species = { ...zaunkoenig, id: 's3', common_name_de: 'Amsel' };
    const project = {
      id: 'p1',
      title: 'Herbst',
      description: '',
      show_optional_fields: true,
      show_net_fields: true,
      projekttyp: Projekttyp.Sonstiges,
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
      norms: [norm, kohlmeiseNorm],
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
      await settle();
      return httpMock;
    }

    function blur(field: string, value: number | null): void {
      component.entryForm.get(field)!.setValue(value);
      component.onMeasurementBlur();
      fixture.detectChanges();
    }

    const icon = (field: string) =>
      fixture.nativeElement.querySelector(
        `[data-testid="plausibility-${field}-icon"]`,
      ) as HTMLElement | null;

    const lastDialogComponent = () => dialogMock.open.calls.mostRecent().args[0];
    const lastDialogMessage = () =>
      (dialogMock.open.calls.mostRecent().args[1].data as { message: string }).message;

    it('opens the single-„Verstanden" InfoDialog when a σ-band field is left out of range', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);
      blur('weight_gram', 25);

      expect(dialogMock.open).toHaveBeenCalledTimes(1);
      expect(lastDialogComponent()).toBe(InfoDialogComponent);
      expect(lastDialogMessage()).toContain(
        'Gewicht 25 g liegt außerhalb des erwarteten Bereichs 7,5–10,7 g (Zaunkönig)',
      );
    });

    it('opens no modal when the value is left in range', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);
      blur('weight_gram', 9);

      expect(dialogMock.open).not.toHaveBeenCalled();
      expect(icon('weight_gram')).toBeNull();
    });

    it('opens no modal when the selected Art carries no Artennorm', async () => {
      await setup();
      component.selectedSpecies.set(unnormedSpecies);
      blur('weight_gram', 25);

      expect(dialogMock.open).not.toHaveBeenCalled();
      expect(icon('weight_gram')).toBeNull();
    });

    it('opens the modal for a Quotient breach and attributes the warning to the Quotient', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);
      // 56/69 = 0,81 is out of the 0,72–0,76 band, while each operand is inside
      // its own σ band — so the only warning is the Quotient's.
      component.entryForm.patchValue({ feather_span: 56, wing_span: 69 });
      component.onMeasurementBlur();
      fixture.detectChanges();

      expect(dialogMock.open).toHaveBeenCalledTimes(1);
      expect(lastDialogComponent()).toBe(InfoDialogComponent);
      expect(lastDialogMessage()).toContain('Quotient Federlänge/Flügellänge');
      expect(lastDialogMessage()).toContain('liegt außerhalb');
    });

    it('produces ONE aggregated modal (not a stack) when a blur trips several checks', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);
      // Flügellänge 90 breaches its own σ band (68,1–77,9) AND the Quotient
      // (54/90 = 0,60) in a single blur.
      component.entryForm.patchValue({ feather_span: 54, wing_span: 90 });
      component.onMeasurementBlur();
      fixture.detectChanges();

      expect(dialogMock.open).toHaveBeenCalledTimes(1);
      const message = lastDialogMessage();
      expect(message).toContain('Flügellänge 90 mm liegt außerhalb');
      expect(message).toContain('Quotient Federlänge/Flügellänge');
    });

    it('does not re-open the modal on an unchanged re-blur, but re-fires for a new out-of-range value', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);

      blur('weight_gram', 25);
      expect(dialogMock.open).toHaveBeenCalledTimes(1);

      // Unchanged re-blur — the acknowledged value must not nag again.
      component.onMeasurementBlur();
      fixture.detectChanges();
      expect(dialogMock.open).toHaveBeenCalledTimes(1);

      // Corrected to a NEW out-of-range value — re-fires.
      blur('weight_gram', 30);
      expect(dialogMock.open).toHaveBeenCalledTimes(2);
    });

    it('clears the warning with no modal when a field is brought back into range', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);

      blur('weight_gram', 25);
      expect(dialogMock.open).toHaveBeenCalledTimes(1);
      expect(icon('weight_gram')).not.toBeNull();

      blur('weight_gram', 9);
      expect(dialogMock.open).toHaveBeenCalledTimes(1);
      expect(icon('weight_gram')).toBeNull();
    });

    it('re-checks every numeric field against the new norm on Art change and raises newly-implausible values', async () => {
      await setup();
      component.onSpeciesSelected({
        option: { value: zaunkoenig },
      } as MatAutocompleteSelectedEvent);
      blur('weight_gram', 25);
      expect(dialogMock.open).toHaveBeenCalledTimes(1);
      expect(lastDialogMessage()).toContain('Zaunkönig');

      // Switching the Art wipes the acknowledgment and re-checks 25 g against the
      // new (Kohlmeise) norm, where it is also out of range → re-raised.
      component.onSpeciesSelected({
        option: { value: kohlmeise },
      } as MatAutocompleteSelectedEvent);
      fixture.detectChanges();

      expect(dialogMock.open).toHaveBeenCalledTimes(2);
      expect(lastDialogMessage()).toContain('Kohlmeise');
    });

    it('shows the quiet warning suffix icon on the breaching σ-band field and keeps it after dismissal', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);
      blur('tarsus', 25);

      expect(dialogMock.open).toHaveBeenCalledTimes(1);
      expect(icon('tarsus')).not.toBeNull();

      // The icon persists after the modal is dismissed: a later unchanged re-blur
      // does not re-open the modal, yet the icon stays.
      component.onMeasurementBlur();
      fixture.detectChanges();
      expect(dialogMock.open).toHaveBeenCalledTimes(1);
      expect(icon('tarsus')).not.toBeNull();
    });

    it('shows the suffix icon on BOTH Federlänge and Flügellänge for a Quotient breach', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);
      component.entryForm.patchValue({ feather_span: 56, wing_span: 69 });
      component.onMeasurementBlur();
      fixture.detectChanges();

      expect(icon('feather_span')).not.toBeNull();
      expect(icon('wing_span')).not.toBeNull();
    });

    it('no longer renders the inline plausibility-warning divs for the numeric fields or the Quotient', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);
      component.entryForm.patchValue({
        weight_gram: 25,
        feather_span: 65,
        wing_span: 90,
        tarsus: 25,
        notch_f2: 12,
        inner_foot: 20,
      });
      component.onMeasurementBlur();
      fixture.detectChanges();

      for (const testid of [
        'plausibility-weight-warning',
        'plausibility-feather_span-warning',
        'plausibility-wing_span-warning',
        'plausibility-quotient-warning',
        'plausibility-tarsus-warning',
        'plausibility-notch_f2-warning',
        'plausibility-inner_foot-warning',
      ]) {
        expect(fixture.nativeElement.querySelector(`[data-testid="${testid}"]`))
          .withContext(testid)
          .toBeNull();
      }
    });

    it('never raises the numeric modal on a categorical change (that is #266)', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);
      blur('weight_gram', 25);
      expect(dialogMock.open).toHaveBeenCalledTimes(1);

      component.entryForm.get('sex')!.setValue(Sex.Male);
      component.onCategoricalChange();
      fixture.detectChanges();

      expect(dialogMock.open).toHaveBeenCalledTimes(1);
    });
  });

  // Issue #266 (PRD #261): extend the modal-on-appearance mechanism to the two
  // CATEGORICAL flags and remove the save-time gate. A determinate Geschlecht on a
  // not-sexable Art, and a Handschwingenmauser settling into the flagged
  // diesjährig combination, each fire the single-„Verstanden" InfoDialog on their
  // selectionChange and mark a quiet suffix icon (on `sex` / `hand_wing`; never on
  // age_class). Same fire-once / re-fire / silent-clear / aggregation as the
  // numeric slice. An Art change re-checks every field (numeric + categorical) and
  // aggregates newly-appeared warnings into ONE modal. onSubmit opens no
  // plausibility modal — saving is never gated on a Warnung.
  describe('kategorisches Plausibilitäts-Modal + Suffix-Icon, Speicher-Gate entfernt (#266)', () => {
    const norm: SpeciesNorm = {
      species_id: 's1',
      species_name: 'Zaunkönig',
      weight_mean: '9.1',
      weight_sd: '0.82',
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
      quotient_mean: null,
      quotient_tolerance_pct: null,
      sd_factor: '1.96',
      geschlechtsbestimmung_moeglich: false,
      dj_grossgefiedermauser_moeglich: false,
    };
    // A second normed Art so an Art change re-checks against a DIFFERENT norm: its
    // flags are armed too and 25 g is out of its 15–19 g band as well.
    const meiseNorm: SpeciesNorm = {
      ...norm,
      species_id: 's2',
      species_name: 'Kohlmeise',
      weight_mean: '17',
      weight_sd: '1',
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
    const kohlmeise: Species = { ...zaunkoenig, id: 's2', common_name_de: 'Kohlmeise' };
    const unnormedSpecies: Species = { ...zaunkoenig, id: 's3', common_name_de: 'Amsel' };
    const project = {
      id: 'p1',
      title: 'Herbst',
      description: '',
      show_optional_fields: true,
      show_net_fields: true,
      projekttyp: Projekttyp.Sonstiges,
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
      norms: [norm, meiseNorm],
      last_consumed_ring_numbers: [],
    };
    const cacheStub = {
      load: () => Promise.resolve({ bundle, refreshedAt: '2026-07-02T08:00:00.000Z' }),
      save: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    };
    const dialogMock = { open: jasmine.createSpy('open') };
    const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
    const sexMessage = 'Geschlechtsbestimmung laut Artennorm nicht möglich (Zaunkönig)';
    const handWingMessage =
      'Großgefiedermauser bei diesjährigem Vogel laut Artennorm nicht zu erwarten (Zaunkönig)';

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

    const icon = (field: string) =>
      fixture.nativeElement.querySelector(
        `[data-testid="plausibility-${field}-icon"]`,
      ) as HTMLElement | null;
    const lastDialogComponent = () => dialogMock.open.calls.mostRecent().args[0];
    const lastDialogMessage = () =>
      (dialogMock.open.calls.mostRecent().args[1].data as { message: string }).message;

    it('opens the single-„Verstanden" modal and marks the Geschlecht suffix icon for a determinate sex on a not-sexable Art', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);
      component.entryForm.get('sex')!.setValue(Sex.Male);
      component.onCategoricalChange();
      fixture.detectChanges();

      expect(dialogMock.open).toHaveBeenCalledTimes(1);
      expect(lastDialogComponent()).toBe(InfoDialogComponent);
      expect(lastDialogMessage()).toContain(sexMessage);
      const el = icon('sex');
      expect(el).not.toBeNull();
      expect(el!.getAttribute('title')).toContain(sexMessage);
    });

    it('opens no modal and marks no Geschlecht icon for Unbekannt (a claim, not an absence)', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);
      component.entryForm.get('sex')!.setValue(Sex.Unknown);
      component.onCategoricalChange();
      fixture.detectChanges();

      expect(dialogMock.open).not.toHaveBeenCalled();
      expect(icon('sex')).toBeNull();
    });

    it('opens the modal and marks the Handschwingenmauser suffix icon for a diesjährigen Vogel with moult present', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);
      component.entryForm.patchValue({
        age_class: AgeClass.ThisYear,
        hand_wing: HandWingMoult.AtLeastOne,
      });
      component.onCategoricalChange();
      fixture.detectChanges();

      expect(dialogMock.open).toHaveBeenCalledTimes(1);
      expect(lastDialogComponent()).toBe(InfoDialogComponent);
      expect(lastDialogMessage()).toContain(handWingMessage);
      const el = icon('hand_wing');
      expect(el).not.toBeNull();
      expect(el!.getAttribute('title')).toContain(handWingMessage);
    });

    it('marks no suffix icon on age_class; the dj-warning icon lives on hand_wing', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);
      component.entryForm.patchValue({
        age_class: AgeClass.ThisYear,
        hand_wing: HandWingMoult.AtLeastOne,
      });
      component.onCategoricalChange();
      fixture.detectChanges();

      expect(icon('age_class')).toBeNull();
      expect(icon('hand_wing')).not.toBeNull();
    });

    it('honours fire-once / re-fire-on-change / silent-clear for a categorical warning', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);

      component.entryForm.get('sex')!.setValue(Sex.Male);
      component.onCategoricalChange();
      fixture.detectChanges();
      expect(dialogMock.open).toHaveBeenCalledTimes(1);
      expect(icon('sex')).not.toBeNull();

      // Unchanged re-evaluation — the acknowledged value must not nag again.
      component.onCategoricalChange();
      fixture.detectChanges();
      expect(dialogMock.open).toHaveBeenCalledTimes(1);

      // A different determinate sex (still not tellable apart) re-fires.
      component.entryForm.get('sex')!.setValue(Sex.Female);
      component.onCategoricalChange();
      fixture.detectChanges();
      expect(dialogMock.open).toHaveBeenCalledTimes(2);

      // Back to Unbekannt — the warning clears silently, no modal, icon gone.
      component.entryForm.get('sex')!.setValue(Sex.Unknown);
      component.onCategoricalChange();
      fixture.detectChanges();
      expect(dialogMock.open).toHaveBeenCalledTimes(2);
      expect(icon('sex')).toBeNull();
    });

    it('re-checks every field (numeric + categorical) against the new norm on Art change and aggregates newly-appeared warnings into ONE modal', async () => {
      await setup();
      component.onSpeciesSelected({
        option: { value: zaunkoenig },
      } as MatAutocompleteSelectedEvent);

      // Settle several breaching values against the first Art via their own
      // triggers and acknowledge them, so nothing is newly-appeared any more.
      component.entryForm.get('weight_gram')!.setValue(25);
      component.onMeasurementBlur();
      component.entryForm.get('sex')!.setValue(Sex.Male);
      component.onCategoricalChange();
      component.entryForm.patchValue({
        age_class: AgeClass.ThisYear,
        hand_wing: HandWingMoult.AtLeastOne,
      });
      component.onCategoricalChange();
      fixture.detectChanges();
      dialogMock.open.calls.reset();

      // Switching the Art wipes ALL signatures and re-checks every field against
      // the new (Kohlmeise) norm — all still breach → ONE aggregated modal.
      component.onSpeciesSelected({
        option: { value: kohlmeise },
      } as MatAutocompleteSelectedEvent);
      fixture.detectChanges();

      expect(dialogMock.open).toHaveBeenCalledTimes(1);
      const message = lastDialogMessage();
      expect(message).toContain('Gewicht 25 g liegt außerhalb');
      expect(message).toContain('Geschlechtsbestimmung laut Artennorm nicht möglich (Kohlmeise)');
      expect(message).toContain(
        'Großgefiedermauser bei diesjährigem Vogel laut Artennorm nicht zu erwarten (Kohlmeise)',
      );
    });

    it('opens no modal and marks no icons when the selected Art carries no Artennorm', async () => {
      await setup();
      component.selectedSpecies.set(unnormedSpecies);
      component.entryForm.patchValue({
        sex: Sex.Male,
        age_class: AgeClass.ThisYear,
        hand_wing: HandWingMoult.AtLeastOne,
      });
      component.onCategoricalChange();
      fixture.detectChanges();

      expect(dialogMock.open).not.toHaveBeenCalled();
      expect(icon('sex')).toBeNull();
      expect(icon('hand_wing')).toBeNull();
    });

    it('no longer renders the inline plausibility-warning divs for sex or hand_wing', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);
      component.entryForm.patchValue({
        sex: Sex.Male,
        age_class: AgeClass.ThisYear,
        hand_wing: HandWingMoult.AtLeastOne,
      });
      component.onCategoricalChange();
      fixture.detectChanges();

      expect(
        fixture.nativeElement.querySelector('[data-testid="plausibility-sex-warning"]'),
      ).toBeNull();
      expect(
        fixture.nativeElement.querySelector('[data-testid="plausibility-hand_wing-warning"]'),
      ).toBeNull();
    });

    it('opens no plausibility modal on submit and writes directly even with active warnings', async () => {
      const httpMock = await setup();
      fillValid();
      component.entryForm.patchValue({
        weight_gram: 25,
        sex: Sex.Male,
        age_class: AgeClass.ThisYear,
        hand_wing: HandWingMoult.AtLeastOne,
      });

      component.onSubmit();

      expect(dialogMock.open).not.toHaveBeenCalled();
      const post = httpMock.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/'),
      );
      post.flush({});
    });
  });

  // Issue #362 (PRD #361): picking an implausible categorical value by its
  // keyboard shortcut must re-run the Plausibilitätskontrolle the instant focus
  // leaves the field — exactly as the mouse selectionChange path already does.
  // The keyboard handler sets the value with setValue(), which does NOT emit
  // MatSelect.selectionChange, so before this fix the warning only surfaced on a
  // later numeric blur. The recompute is wired for ALL categorical selects, and
  // because the keyboard flow also advances focus, the newly-appeared-warning
  // modal restores focus to the picked field on dismissal.
  describe('Plausibilitätskontrolle bei Tastatur-Auswahl kategorialer Felder (#362)', () => {
    // A Zaunkönig norm arming one numeric rule (Gewicht) plus both categorical
    // flags, so a keyboard-picked implausible value yields a warning.
    const norm: SpeciesNorm = {
      species_id: 's1',
      species_name: 'Zaunkönig',
      weight_mean: '9.1',
      weight_sd: '0.82',
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
      quotient_mean: null,
      quotient_tolerance_pct: null,
      sd_factor: '1.96',
      geschlechtsbestimmung_moeglich: false,
      dj_grossgefiedermauser_moeglich: false,
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
    const unnormedSpecies: Species = { ...zaunkoenig, id: 's3', common_name_de: 'Amsel' };
    const project = {
      id: 'p1',
      title: 'Herbst',
      description: '',
      show_optional_fields: true,
      show_net_fields: true,
      projekttyp: Projekttyp.Sonstiges,
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
    const sexMessage = 'Geschlechtsbestimmung laut Artennorm nicht möglich (Zaunkönig)';
    const handWingMessage =
      'Großgefiedermauser bei diesjährigem Vogel laut Artennorm nicht zu erwarten (Zaunkönig)';

    async function setup(): Promise<HttpTestingController> {
      TestBed.resetTestingModule();
      dialogMock.open.calls.reset();
      dialogMock.open.and.returnValue({ afterClosed: () => of(undefined) });
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

    const icon = (field: string) =>
      fixture.nativeElement.querySelector(
        `[data-testid="plausibility-${field}-icon"]`,
      ) as HTMLElement | null;
    const lastDialogComponent = () => dialogMock.open.calls.mostRecent().args[0];
    const lastDialogMessage = () =>
      (dialogMock.open.calls.mostRecent().args[1].data as { message: string }).message;

    // Drive a single-character keyboard shortcut through the MatSelect keydown
    // handler, mimicking a Beringer typing the option key on a focused select.
    // A stub MatSelect (only close() is touched) keeps the test off real Material.
    const keyPick = (controlName: string, options: SelectOption<unknown>[], key: string): void => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      const select = { close: jasmine.createSpy('close') } as unknown as MatSelect;
      component.onSelectKeydown(event, controlName, options, select);
    };

    // focusNext() schedules a real setTimeout(50) to advance focus. Let it settle
    // so it neither leaks into a later spec nor races the focus assertions.
    const drainFocusTimers = () => new Promise<void>((resolve) => setTimeout(resolve, 60));

    it('surfaces the Plausibilitätswarnung immediately when an implausible Geschlecht is picked by keyboard shortcut (no later blur needed)', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);

      // "1" → Sex.Male against a not-sexable Art. The shortcut alone must trigger
      // the check — no measurement blur follows.
      keyPick('sex', component.sexOptions, '1');
      fixture.detectChanges();

      expect(component.entryForm.get('sex')!.value).toBe(Sex.Male);
      expect(dialogMock.open).toHaveBeenCalledTimes(1);
      expect(lastDialogComponent()).toBe(InfoDialogComponent);
      expect(lastDialogMessage()).toContain(sexMessage);
      const el = icon('sex');
      expect(el).not.toBeNull();
      expect(el!.getAttribute('title')).toContain(sexMessage);

      await drainFocusTimers();
    });

    it('wires the trigger for a NON-Geschlecht categorical select too (Handschwingenmauser), so all categorical fields inherit the timing', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);
      // dj-Großgefiedermauser rule: a diesjähriger Vogel with moult present.
      component.entryForm.get('age_class')!.setValue(AgeClass.ThisYear);

      // "2" → HandWingMoult.AtLeastOne, picked purely by keyboard shortcut.
      keyPick('hand_wing', component.handWingMoultOptions, '2');
      fixture.detectChanges();

      expect(component.entryForm.get('hand_wing')!.value).toBe(HandWingMoult.AtLeastOne);
      expect(dialogMock.open).toHaveBeenCalledTimes(1);
      expect(lastDialogMessage()).toContain(handWingMessage);
      expect(icon('hand_wing')).not.toBeNull();

      await drainFocusTimers();
    });

    it('opens no modal when the keyboard-picked value is plausible (mirrors mouse selection — the rules are unchanged)', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);

      // "0" → Sex.Unknown: a claimed absence, never implausible.
      keyPick('sex', component.sexOptions, '0');
      fixture.detectChanges();

      expect(component.entryForm.get('sex')!.value).toBe(Sex.Unknown);
      expect(dialogMock.open).not.toHaveBeenCalled();
      expect(icon('sex')).toBeNull();

      await drainFocusTimers();
    });

    it('honours fire-once, stays silent on an unchanged re-pick, and re-alerts when the keyboard changes an already-flagged value to a different implausible one', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);

      // Male against a not-sexable Art → the warning fires once.
      keyPick('sex', component.sexOptions, '1');
      fixture.detectChanges();
      expect(dialogMock.open).toHaveBeenCalledTimes(1);
      expect(icon('sex')).not.toBeNull();

      // Re-picking the SAME value is acknowledged — it must not nag again.
      keyPick('sex', component.sexOptions, '1');
      fixture.detectChanges();
      expect(dialogMock.open).toHaveBeenCalledTimes(1);

      // A DIFFERENT still-implausible value (Weiblich) re-alerts.
      keyPick('sex', component.sexOptions, '2');
      fixture.detectChanges();
      expect(dialogMock.open).toHaveBeenCalledTimes(2);

      await drainFocusTimers();
    });

    it('returns keyboard focus to the picked field once the newly-appeared-warning modal is dismissed', async () => {
      await setup();
      component.selectedSpecies.set(zaunkoenig);

      // The modal stays open until the ringer dismisses it — model that with a
      // Subject we complete ourselves, AFTER the keyboard flow has advanced focus.
      const afterClosed = new Subject<void>();
      dialogMock.open.and.returnValue({ afterClosed: () => afterClosed });

      keyPick('sex', component.sexOptions, '1');
      fixture.detectChanges();
      expect(dialogMock.open).toHaveBeenCalledTimes(1);

      // The keyboard flow advances focus off the picked field first (focusNext).
      await drainFocusTimers();
      const sexEl = fixture.nativeElement.querySelector(
        '[formControlName="sex"]',
      ) as HTMLElement;
      expect(document.activeElement).not.toBe(sexEl);

      // Dismissing the modal restores focus to the picked field so entry continues.
      afterClosed.next();
      afterClosed.complete();
      expect(document.activeElement).toBe(sexEl);
    });
  });

  // Issue #267 (PRD #261): Bearbeiten-Modus. Opening an existing capture whose
  // STORED values already breach the Artennorm must reveal every flagged field's
  // quiet suffix `warning` icon on load, yet raise NO „Verstanden" modal — a
  // warning present on load has no trigger event. The modal fires only on the
  // first real interaction — a numeric blur, a categorical selectionChange, or an
  // Art change — through the same „fire once, never nag" de-dup as #265/#266.
  // Load path only; nothing new persisted.
  describe('Bearbeiten-Modus: Warnicons beim Laden ohne Modal, Modal erst bei erster Interaktion (#267)', () => {
    // A norm arming BOTH numeric (σ-band Gewicht/Tarsus) and categorical
    // (Geschlecht not tellable apart, no dj-Großgefiedermauser) rules.
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
      quotient_mean: '0.74',
      quotient_tolerance_pct: '3',
      sd_factor: '1.96',
      geschlechtsbestimmung_moeglich: false,
      dj_grossgefiedermauser_moeglich: false,
    };
    // A second normed Art so an Art change re-checks against a DIFFERENT norm: the
    // stored 25 g is out of its 15–19 g band too, and its flags are armed as well.
    const kohlmeiseNorm: SpeciesNorm = {
      ...norm,
      species_id: 's2',
      species_name: 'Kohlmeise',
      weight_mean: '17',
      weight_sd: '1',
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
    const kohlmeise: Species = { ...zaunkoenig, id: 's2', common_name_de: 'Kohlmeise' };
    const project = {
      id: 'p1',
      title: 'Herbst',
      description: '',
      show_optional_fields: true,
      show_net_fields: true,
      projekttyp: Projekttyp.Sonstiges,
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
      norms: [norm, kohlmeiseNorm],
      last_consumed_ring_numbers: [],
    };
    const cacheStub = {
      load: () => Promise.resolve({ bundle, refreshedAt: '2026-07-02T08:00:00.000Z' }),
      save: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    };
    const dialogMock = { open: jasmine.createSpy('open') };
    const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

    // An existing Zaunkönig capture whose STORED values are already out of range:
    // Gewicht 25 g (band 7,5–10,7) and Tarsus 25 mm (band ~17,8–20,2) both breach
    // their σ band, the determined Geschlecht contradicts the not-sexable flag, and
    // the diesjährige Großgefiedermauser contradicts its flag. Federlänge/Flügellänge
    // stay inside their σ bands (and their Quotient inside its band), so those two
    // fields are the deliberate in-range control.
    function outOfRangeEntry(overrides: Partial<DataEntry> = {}): DataEntry {
      return {
        id: '77',
        species: zaunkoenig,
        ring: { id: 'r1', number: '901234', size: RingSize.S },
        staff: { id: 'p1', handle: 'FRE', full_name: 'Filip Reiter' },
        ringing_station: { handle: 'STAMT', name: 'Linz', organization: project.organization },
        project: null,
        weight_gram: 25,
        tarsus: 25,
        feather_span: 54,
        wing_span: 73,
        notch_f2: null,
        inner_foot: null,
        sex: Sex.Female,
        age_class: AgeClass.ThisYear,
        hand_wing: HandWingMoult.AtLeastOne,
        bird_status: BirdStatus.ReCatch,
        date_time: '2024-05-01T08:30:00Z',
        parasites: [],
        has_hunger_stripes: false,
        has_brood_patch: false,
        has_cpl_plus: false,
        ...overrides,
      } as unknown as DataEntry;
    }

    async function loadEdit(
      entry: DataEntry,
    ): Promise<{ f: ComponentFixture<DataEntryFormComponent>; editComponent: DataEntryFormComponent }> {
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
        .flush(entry);
      // The record and its Artennorm load independently; settle lets both finish.
      await settle();
      f.detectChanges();
      return { f, editComponent };
    }

    const icon = (f: ComponentFixture<DataEntryFormComponent>, field: string) =>
      f.nativeElement.querySelector(
        `[data-testid="plausibility-${field}-icon"]`,
      ) as HTMLElement | null;
    const lastDialogComponent = () => dialogMock.open.calls.mostRecent().args[0];
    const lastDialogMessage = () =>
      (dialogMock.open.calls.mostRecent().args[1].data as { message: string }).message;

    it('reveals a suffix warning icon on every already-out-of-range field on load', async () => {
      const { f } = await loadEdit(outOfRangeEntry());

      expect(icon(f, 'weight_gram')).withContext('Gewicht').not.toBeNull();
      expect(icon(f, 'tarsus')).withContext('Tarsus').not.toBeNull();
      expect(icon(f, 'sex')).withContext('Geschlecht').not.toBeNull();
      expect(icon(f, 'hand_wing')).withContext('Handschwingenmauser').not.toBeNull();
      // The load evaluates the Prüfung, not a blanket flag: an in-band field
      // carries no icon.
      expect(icon(f, 'feather_span')).withContext('Federlänge (in band)').toBeNull();
    });

    it('opens NO plausibility modal merely from loading the record', async () => {
      await loadEdit(outOfRangeEntry());

      expect(dialogMock.open).not.toHaveBeenCalled();
    });

    it('raises the single-„Verstanden" modal once when a flagged numeric field is blurred after load', async () => {
      const { f, editComponent } = await loadEdit(outOfRangeEntry());
      expect(dialogMock.open).not.toHaveBeenCalled();

      // The Beringer touches the field without changing it — its warning is still
      // active, so the first interaction raises it.
      editComponent.onMeasurementBlur();
      f.detectChanges();

      expect(dialogMock.open).toHaveBeenCalledTimes(1);
      expect(lastDialogComponent()).toBe(InfoDialogComponent);
      expect(lastDialogMessage()).toContain('Gewicht 25 g liegt außerhalb');

      // Fire-once: an unchanged re-blur must not nag again.
      editComponent.onMeasurementBlur();
      f.detectChanges();
      expect(dialogMock.open).toHaveBeenCalledTimes(1);
    });

    it('raises the modal once when a flagged categorical field is changed after load', async () => {
      const { f, editComponent } = await loadEdit(outOfRangeEntry());
      expect(dialogMock.open).not.toHaveBeenCalled();

      editComponent.onCategoricalChange();
      f.detectChanges();

      expect(dialogMock.open).toHaveBeenCalledTimes(1);
      expect(lastDialogComponent()).toBe(InfoDialogComponent);
      expect(lastDialogMessage()).toContain(
        'Geschlechtsbestimmung laut Artennorm nicht möglich (Zaunkönig)',
      );
    });

    it('re-checks every field against the new norm and raises newly-implausible values when the Art changes after load', async () => {
      const { f, editComponent } = await loadEdit(outOfRangeEntry());
      expect(dialogMock.open).not.toHaveBeenCalled();

      editComponent.onSpeciesSelected({
        option: { value: kohlmeise },
      } as MatAutocompleteSelectedEvent);
      f.detectChanges();

      expect(dialogMock.open).toHaveBeenCalledTimes(1);
      expect(lastDialogComponent()).toBe(InfoDialogComponent);
      expect(lastDialogMessage()).toContain('Gewicht 25 g liegt außerhalb');
      expect(lastDialogMessage()).toContain('(Kohlmeise)');
    });
  });

  // PRD #333, issue #338: the shared focus system — create-mode autofocus, the
  // return-focus after „Verstanden", and left/right arrow field navigation.
  describe('focus system: create-mode autofocus (#338)', () => {
    afterEach(() => localStorage.clear());

    it('focuses the Art field with no click when a create-mode form opens', async () => {
      await setupCreateMode();
      const species = fixture.nativeElement.querySelector('[formControlName="species"]');
      expect(document.activeElement).toBe(species);
    });

    it('does not force-focus the Art field in edit mode (reviewing an existing record)', async () => {
      const routeStub = {
        snapshot: { paramMap: { get: (key: string) => (key === 'id' ? '42' : null) } },
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
      f.detectChanges();
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/data-entries/42/'))
        .flush({
          id: '42',
          species: { id: 's1', common_name_de: 'Kohlmeise', ring_size: RingSize.S },
          ring: { id: 'r1', number: '901234', size: RingSize.S },
          staff: { id: 'p1', handle: 'FRE', full_name: 'Filip Reiter' },
          ringing_station: { handle: 'STAMT', name: 'Linz' },
          project: null,
          bird_status: BirdStatus.ReCatch,
          age_class: AgeClass.ThisYear,
          sex: Sex.Female,
          date_time: '2024-05-01T08:30:00Z',
          parasites: [],
          has_hunger_stripes: false,
          has_brood_patch: false,
          has_cpl_plus: false,
        } as unknown as DataEntry);
      f.detectChanges();

      const species = f.nativeElement.querySelector('[formControlName="species"]');
      // Edit mode never steals focus onto Art; the ringer is reviewing a record.
      expect(document.activeElement).not.toBe(species);
    });
  });

  // ADR 0027 (#376): the optional Ja/Nein flags reorder to Brutfleck, CPL+,
  // Hungerstreifen and the former single Milben checkbox becomes a multi-valued
  // Parasit Mehrfachauswahl rendered after them.
  describe('Parasit Mehrfachauswahl and flag order (ADR 0027, #376)', () => {
    afterEach(() => localStorage.clear());

    beforeEach(async () => {
      await setupCreateMode();
    });

    it('renders the Ja/Nein flags in the order Brutfleck, CPL+, Hungerstreifen', () => {
      const labels = Array.from(
        fixture.nativeElement.querySelectorAll('.form-section-checkboxes mat-checkbox'),
      ).map((cb) => (cb as HTMLElement).textContent?.trim());
      expect(labels).toEqual(['Brutfleck', 'CPL+', 'Hungerstreifen']);
    });

    it('has no standalone Milben checkbox any more', () => {
      const mites = fixture.nativeElement.querySelector(
        'mat-checkbox[formControlName="has_mites"]',
      );
      expect(mites).toBeNull();
    });

    it('renders a Parasit multi-select after the flags', () => {
      const parasit = fixture.debugElement
        .queryAll(By.directive(MatSelect))
        .find((de) => de.attributes['formControlName'] === 'parasites');
      expect(parasit).toBeTruthy();
      expect((parasit!.componentInstance as MatSelect).multiple).toBe(true);
    });

    it('defaults the Parasit selection to an empty list', () => {
      expect(component.entryForm.get('parasites')!.value).toEqual([]);
    });

    it('carries the selected parasite codes onto the form value', () => {
      component.entryForm.get('parasites')!.setValue([Parasit.RedMites]);
      fixture.detectChanges();
      expect(component.entryForm.getRawValue().parasites).toEqual([Parasit.RedMites]);
    });
  });

  describe('focus system: left/right arrow field navigation (#338)', () => {
    afterEach(() => localStorage.clear());

    beforeEach(async () => {
      await setupCreateMode();
    });

    const el = (name: string) =>
      fixture.nativeElement.querySelector(`[formControlName="${name}"]`) as HTMLElement;

    const arrow = (key: 'ArrowLeft' | 'ArrowRight') =>
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });

    it('advances to the next field on right arrow from a select (no caret)', fakeAsync(() => {
      const age = el('age_class');
      age.focus();

      const event = arrow('ArrowRight');
      age.dispatchEvent(event);
      tick(50);

      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(el('sex'));
    }));

    it('goes to the previous field on left arrow from a select (no caret)', fakeAsync(() => {
      const sex = el('sex');
      sex.focus();

      const event = arrow('ArrowLeft');
      sex.dispatchEvent(event);
      tick(50);

      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(el('age_class'));
    }));

    it('jumps immediately from a checkbox (no caret) on left arrow', fakeAsync(() => {
      const checkbox = fixture.nativeElement.querySelector(
        'mat-checkbox[formControlName="has_brood_patch"] input',
      ) as HTMLInputElement;
      checkbox.focus();

      const event = arrow('ArrowLeft');
      checkbox.dispatchEvent(event);
      tick(50);

      // has_brood_patch is the first flag (ADR 0027 #7a order), so its predecessor
      // in the focus order is the Bemerkungen textarea.
      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(el('comment'));
    }));

    it('advances from the end of a text field (caret at the edge)', fakeAsync(() => {
      const ringNumber = el('ring_number') as HTMLInputElement;
      ringNumber.value = '12345';
      ringNumber.focus();
      ringNumber.setSelectionRange(5, 5);

      const event = arrow('ArrowRight');
      ringNumber.dispatchEvent(event);
      tick(50);

      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(el('net_location'));
    }));

    it('goes back from the start of a text field (caret at the edge)', fakeAsync(() => {
      const ringNumber = el('ring_number') as HTMLInputElement;
      ringNumber.value = '12345';
      ringNumber.focus();
      ringNumber.setSelectionRange(0, 0);

      const event = arrow('ArrowLeft');
      ringNumber.dispatchEvent(event);
      tick(50);

      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(el('ring_size'));
    }));

    it('moves the caret inside a partly-filled text field instead of jumping', fakeAsync(() => {
      const ringNumber = el('ring_number') as HTMLInputElement;
      ringNumber.value = '12345';
      ringNumber.focus();
      ringNumber.setSelectionRange(2, 2);

      const event = arrow('ArrowRight');
      ringNumber.dispatchEvent(event);
      tick(50);

      // The caret is mid-value, so the arrow stays native and focus does not move.
      expect(event.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(ringNumber);
    }));

    it('keeps native behaviour in a datetime-local field (segment stepping)', fakeAsync(() => {
      const dateTime = el('date_time') as HTMLInputElement;
      dateTime.focus();

      const event = arrow('ArrowRight');
      dateTime.dispatchEvent(event);
      tick(50);

      expect(event.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(dateTime);
    }));

    it('keeps native behaviour while the Art autocomplete panel is open', fakeAsync(() => {
      const species = el('species') as HTMLInputElement;
      species.setAttribute('aria-expanded', 'true');
      species.focus();

      const event = arrow('ArrowRight');
      species.dispatchEvent(event);
      tick(50);

      // The open panel owns the arrows for option navigation — no field jump.
      expect(event.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(species);
    }));

    it('skips a disabled field (the greyed-out Kleingefieder Fortschritt)', fakeAsync(() => {
      // Default Alter (Unbekannt) disables small_feather_app (Fortschritt).
      expect(component.entryForm.get('small_feather_app')!.disabled).toBe(true);

      const smallInt = el('small_feather_int');
      smallInt.focus();

      const event = arrow('ArrowRight');
      smallInt.dispatchEvent(event);
      tick(50);

      // small_feather_app is skipped; focus lands on the next live field.
      expect(document.activeElement).toBe(el('hand_wing'));
    }));

    // A real arrow key carries a keyCode (LEFT=37, RIGHT=39); the KeyboardEvent
    // constructor drops keyCode, so define it explicitly. Material's own
    // <mat-select> keydown handler is keyCode-driven, so only a keyCode-bearing
    // event exercises the value-mutation path this fix must suppress.
    const arrowWithKeyCode = (key: 'ArrowLeft' | 'ArrowRight', keyCode: number) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      Object.defineProperty(event, 'keyCode', { get: () => keyCode });
      return event;
    };

    it('does not mutate a closed <mat-select> value on an arrow jump (real keyCode)', fakeAsync(() => {
      // Alter defaults to Unbekannt, which sits mid-list (index 1 of 6), so
      // Material's key manager has a Right-neighbour it would advance to.
      const age = el('age_class');
      expect(component.entryForm.get('age_class')!.value).toBe(AgeClass.Unknown);
      age.focus();

      // Without capture-phase suppression, MatSelect's own element-level keydown
      // fires first at the target and routes RIGHT to its key manager, whose
      // change subscription calls _selectViaInteraction() and advances the
      // selection to Diesjährig BEFORE the jump handler bubbles up. The fix must
      // stop that: the value stays put and only focus moves on.
      const event = arrowWithKeyCode('ArrowRight', 39);
      age.dispatchEvent(event);
      tick(50);

      expect(event.defaultPrevented).toBe(true);
      expect(component.entryForm.get('age_class')!.value).toBe(AgeClass.Unknown);
      expect(document.activeElement).toBe(el('sex'));
    }));

    it('does not mutate a closed <mat-select> value on a left arrow jump (real keyCode)', fakeAsync(() => {
      // Seed Geschlecht = Weiblich (index 2 of 3) so its key manager has a
      // Left-neighbour (Männlich) it would otherwise step back onto.
      component.entryForm.get('sex')!.setValue(Sex.Female);
      fixture.detectChanges();
      const sex = el('sex');
      sex.focus();

      const event = arrowWithKeyCode('ArrowLeft', 37);
      sex.dispatchEvent(event);
      tick(50);

      expect(event.defaultPrevented).toBe(true);
      expect(component.entryForm.get('sex')!.value).toBe(Sex.Female);
      expect(document.activeElement).toBe(el('age_class'));
    }));

    it('jumps immediately from an empty measurement field (no caret to preserve)', fakeAsync(() => {
      // #341 made the six measurement inputs type=text (appNumberMask). Empty,
      // such a field has no caret position to protect, so left/right jump like a
      // select rather than dead-ending.
      const tarsus = el('tarsus') as HTMLInputElement;
      expect(tarsus.type).toBe('text');
      expect(tarsus.value).toBe('');
      tarsus.focus();

      const event = arrow('ArrowRight');
      tarsus.dispatchEvent(event);
      tick(50);

      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(el('feather_span'));
    }));

    it('does caret-boundary navigation in a partly-filled measurement field (type=text after #341)', fakeAsync(() => {
      // Integration note (#338 × #341): #338 originally had to exempt the
      // measurement fields because type=number exposes no caret API. #341 changed
      // them to type=text (appNumberMask), which restores a real caret — so they
      // now follow the normal caret-boundary rule the original #338 AC described:
      // the arrow moves the caret within the value and only jumps at the edge.
      const tarsus = el('tarsus') as HTMLInputElement;
      expect(tarsus.type).toBe('text');
      tarsus.value = '123';
      tarsus.focus();

      // Caret in the middle → the right arrow moves it natively, no field jump.
      tarsus.setSelectionRange(1, 1);
      const mid = arrow('ArrowRight');
      tarsus.dispatchEvent(mid);
      tick(50);
      expect(mid.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(tarsus);

      // Caret at the end → the right arrow jumps to the next field.
      tarsus.setSelectionRange(3, 3);
      const edge = arrow('ArrowRight');
      tarsus.dispatchEvent(edge);
      tick(50);
      expect(edge.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(el('feather_span'));
    }));
  });

  describe('focus system: arrow navigation skips net fields hidden by the Projekt (#338)', () => {
    afterEach(() => localStorage.clear());

    it('jumps from Ringnummer straight to Alter when the net block is hidden', fakeAsync(() => {
      TestBed.resetTestingModule();
      const hiddenNetProject = {
        id: 'p1',
        title: 'Herbst',
        description: '',
        show_optional_fields: true,
        show_net_fields: false,
        projekttyp: Projekttyp.Sonstiges,
        organization: { id: 'o1', handle: 'IWM', name: 'IWM Linz', country: 'AT' },
        default_station: null,
        scientists: [],
        created: '',
        updated: '',
      } as Project;
      TestBed.configureTestingModule({
        imports: [DataEntryFormComponent],
        providers: [
          provideRouter([]),
          provideHttpClient(),
          provideHttpClientTesting(),
          provideNoopAnimations(),
          {
            provide: ProjectService,
            useValue: {
              currentProject: signal<Project | null>(hiddenNetProject),
              setCurrent: () => {},
              clear: () => {},
            },
          },
        ],
      });
      const f = TestBed.createComponent(DataEntryFormComponent);
      const httpMock = TestBed.inject(HttpTestingController);
      f.detectChanges();
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/species/'))
        .flush({ count: 0, next: null, previous: null, results: [] });
      f.detectChanges();

      const at = (name: string) =>
        f.nativeElement.querySelector(`[formControlName="${name}"]`) as HTMLElement;

      // The three net controls are hidden by the Projekt switch.
      expect(at('net_location')).toBeNull();

      const ringNumber = at('ring_number') as HTMLInputElement;
      ringNumber.value = '12345';
      ringNumber.focus();
      ringNumber.setSelectionRange(5, 5);

      const event = new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
      });
      ringNumber.dispatchEvent(event);
      tick(50);

      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(at('age_class'));
    }));
  });

  // #392 (ADR 0030): „Eintrag löschen" in der Erfassungsmaske — Bestätigung,
  // DELETE, zurück zur Liste und ein „Rückgängig"-Snackbar als einzige
  // Wiederherstellung. Der Knopf ist die gefährlichste Aktion der Zeile und
  // deshalb nur absichtlich erreichbar (tabindex="-1", #387).
  describe('Eintrag löschen aus der Erfassungsmaske (#392)', () => {
    const dialogMock = { open: jasmine.createSpy('open') };
    let fixture: ComponentFixture<DataEntryFormComponent>;
    let httpMock: HttpTestingController;

    function savedEntry(): DataEntry {
      return {
        id: '42',
        species: { id: 's1', common_name_de: 'Kohlmeise', scientific_name: 'Parus major', ring_size: RingSize.S },
        ring: { id: 'r1', number: '901234', size: RingSize.S },
        staff: { id: 'p1', handle: 'FRE', full_name: 'Filip Reiter' },
        ringing_station: { handle: 'STAMT', name: 'Linz', organization: { id: 'o1', handle: 'IWM', name: 'IWM Linz', country: 'AT' } },
        project: null,
        bird_status: BirdStatus.ReCatch,
        date_time: '2024-05-01T08:30:00Z',
        comment: 'Wiederfang am Hauptnetz',
        parasites: [],
      } as unknown as DataEntry;
    }

    // `entryId: null` baut die Maske im Erstellen-Modus auf (dann braucht sie ein
    // aktives Projekt, sonst leitet sie nach Hause um).
    async function setupForm(entryId: string | null = '42'): Promise<void> {
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
            provide: ActivatedRoute,
            useValue: { snapshot: { paramMap: { get: (key: string) => (key === 'id' ? entryId : null) } } },
          },
          {
            provide: ProjectService,
            useValue: { currentProject: signal<Project | null>(createProject()), setCurrent: () => {}, clear: () => {} },
          },
        ],
      })
        .overrideComponent(DataEntryFormComponent, {
          add: { providers: [{ provide: MatDialog, useValue: dialogMock }] },
        })
        .compileComponents();

      fixture = TestBed.createComponent(DataEntryFormComponent);
      httpMock = TestBed.inject(HttpTestingController);
      fixture.detectChanges();
      if (entryId === null) {
        httpMock
          .expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/species/'))
          .flush({ count: 0, next: null, previous: null, results: [] });
      } else {
        httpMock
          .expectOne((r) => r.method === 'GET' && r.url.endsWith(`/birds/data-entries/${entryId}/`))
          .flush(savedEntry());
      }
      fixture.detectChanges();
    }

    const btn = (testid: string): HTMLButtonElement | null =>
      fixture.nativeElement.querySelector(`.action-buttons button[data-testid="${testid}"]`);

    // Die Maske importiert MatSnackBarModule selbst und hält deshalb eine EIGENE
    // MatSnackBar-Instanz — TestBed.inject() liefert die falsche. Immer die aus
    // dem Component-Injector greifen.
    const snackBarOf = (f: ComponentFixture<DataEntryFormComponent>): MatSnackBar =>
      (f.componentInstance as unknown as { snackBar: MatSnackBar }).snackBar;

    it('renders a danger "Eintrag löschen" left of "Zurücksetzen", skipped by Tab', async () => {
      await setupForm();

      const del = btn('delete-entry-button');
      expect(del).not.toBeNull();
      expect(del!.textContent!.trim()).toBe('Eintrag löschen');
      // Die gefährlichste Aktion der Zeile: nur absichtlich erreichbar (#387).
      expect(del!.getAttribute('tabindex')).toBe('-1');
      // Danger: in der Fehlerfarbe der Marke gezeichnet, nicht wie „Zur Liste"
      // daneben. Material 3 kennt kein color="warn" mehr — die Farbe kommt aus
      // dem Token, deshalb wird hier die GERENDERTE Farbe geprüft, nicht ein
      // Attribut, das nichts bewirkt.
      expect(getComputedStyle(del!).color).toBe('rgb(168, 65, 45)');

      // Links von „Zurücksetzen" — die Reihenfolge in der Zeile ist die Aussage.
      const labels = (Array.from(fixture.nativeElement.querySelectorAll('.action-buttons button')) as
        HTMLButtonElement[]).map((b) => b.textContent!.trim());
      expect(labels.indexOf('Eintrag löschen')).toBeLessThan(labels.indexOf('Zurücksetzen'));
    });

    it('does not render the delete button in create mode — there is nothing to delete yet', async () => {
      await setupForm(null);

      expect(
        fixture.nativeElement.querySelector('.action-buttons button[data-testid="delete-entry-button"]'),
      ).toBeNull();
    });

    it('opens the shared Bestätigung on click, worded „löschen" (kein „Storno")', async () => {
      await setupForm();
      dialogMock.open.and.returnValue({ afterClosed: () => of(false) });

      btn('delete-entry-button')!.click();

      expect(dialogMock.open).toHaveBeenCalled();
      const [componentArg, config] = dialogMock.open.calls.mostRecent().args as [
        unknown,
        { data: ConfirmDialogData },
      ];
      expect(componentArg).toBe(ConfirmDialogComponent);
      // ADR 0030: „Löschen" ist das einzige Wort an der Oberfläche.
      expect(config.data.title).toBe('Eintrag löschen?');
      expect(config.data.confirmLabel).toBe('Löschen');
      expect(JSON.stringify(config.data)).not.toMatch(/Storno|storniert/i);
    });

    it('deletes and returns to the list once the modal is confirmed', async () => {
      await setupForm();
      dialogMock.open.and.returnValue({ afterClosed: () => of(true) });
      const snackBar = snackBarOf(fixture);
      const openSpy = spyOn(snackBar, 'open').and.returnValue({ onAction: () => EMPTY } as never);
      const navigateSpy = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);

      btn('delete-entry-button')!.click();

      httpMock
        .expectOne((r) => r.method === 'DELETE' && r.url.endsWith('/birds/data-entries/42/'))
        .flush(null, { status: 204, statusText: 'No Content' });

      expect(navigateSpy).toHaveBeenCalledWith('/data-entries');
      expect(openSpy).toHaveBeenCalled();
    });

    it('deletes nothing when the modal is cancelled', async () => {
      await setupForm();
      dialogMock.open.and.returnValue({ afterClosed: () => of(false) });
      const navigateSpy = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);

      btn('delete-entry-button')!.click();

      httpMock.expectNone((r) => r.method === 'DELETE');
      expect(navigateSpy).not.toHaveBeenCalled();
    });

    it('offers „Rückgängig" for ~10s and restores the entry when it is used', async () => {
      await setupForm();
      dialogMock.open.and.returnValue({ afterClosed: () => of(true) });
      const action = new Subject<void>();
      const openSpy = spyOn(snackBarOf(fixture), 'open').and.returnValue({
        onAction: () => action,
      } as never);
      spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);

      btn('delete-entry-button')!.click();
      httpMock
        .expectOne((r) => r.method === 'DELETE' && r.url.endsWith('/birds/data-entries/42/'))
        .flush(null, { status: 204, statusText: 'No Content' });

      const [, actionLabel, config] = openSpy.calls.mostRecent().args as [
        string,
        string,
        { duration: number },
      ];
      expect(actionLabel).toBe('Rückgängig');
      expect(config.duration).toBe(10000);

      // Die Nutzerin tippt „Rückgängig", solange das Fenster offen ist.
      action.next();

      httpMock
        .expectOne((r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/42/restore/'))
        .flush(savedEntry());
    });

    // Der Klick auf „Löschen" navigiert weg und zerstört damit genau die
    // Komponente, die das Undo hält. Das Snackbar überlebt (es hängt an der
    // Wurzel-Instanz), also darf die onAction-Subscription NICHT an den DestroyRef
    // gehängt sein — sonst räumt die Navigation das Undo ab, für das sie da ist.
    it('still restores after the navigation away has destroyed the form', async () => {
      await setupForm();
      dialogMock.open.and.returnValue({ afterClosed: () => of(true) });
      const action = new Subject<void>();
      spyOn(snackBarOf(fixture), 'open').and.returnValue({ onAction: () => action } as never);
      spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);

      btn('delete-entry-button')!.click();
      httpMock
        .expectOne((r) => r.method === 'DELETE' && r.url.endsWith('/birds/data-entries/42/'))
        .flush(null, { status: 204, statusText: 'No Content' });

      // Was die echte Navigation tut: die Maske ist weg, das Snackbar steht noch.
      fixture.destroy();
      action.next();

      httpMock
        .expectOne((r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/42/restore/'))
        .flush(savedEntry());
    });

    // Review-Fund: das Restore allein genügt nicht. Die Liste, auf die das
    // Löschen navigiert hat, hat da längst geladen — ohne diesen Anstoß meldet
    // „Eintrag wurde wiederhergestellt.", während der Fang auf dem Bildschirm
    // fehlt. Die Liste selbst lädt daraufhin nach (data-entry-list.spec.ts).
    it('asks the list to reload once the restore succeeded — the success must be visible', async () => {
      await setupForm();
      dialogMock.open.and.returnValue({ afterClosed: () => of(true) });
      const action = new Subject<void>();
      spyOn(snackBarOf(fixture), 'open').and.returnValue({ onAction: () => action } as never);
      spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
      const refresh = TestBed.inject(DataEntryRefreshService);
      const before = refresh.token();

      btn('delete-entry-button')!.click();
      httpMock
        .expectOne((r) => r.method === 'DELETE' && r.url.endsWith('/birds/data-entries/42/'))
        .flush(null, { status: 204, statusText: 'No Content' });

      action.next();
      // Solange das Restore läuft, ist noch nichts wiederhergestellt.
      expect(refresh.token()).toBe(before);

      httpMock
        .expectOne((r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/42/restore/'))
        .flush(savedEntry());

      expect(refresh.token()).toBeGreaterThan(before);
    });

    it('does not ask the list to reload when the restore failed', async () => {
      await setupForm();
      dialogMock.open.and.returnValue({ afterClosed: () => of(true) });
      const action = new Subject<void>();
      spyOn(snackBarOf(fixture), 'open').and.returnValue({ onAction: () => action } as never);
      spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
      const refresh = TestBed.inject(DataEntryRefreshService);
      const before = refresh.token();

      btn('delete-entry-button')!.click();
      httpMock
        .expectOne((r) => r.method === 'DELETE' && r.url.endsWith('/birds/data-entries/42/'))
        .flush(null, { status: 204, statusText: 'No Content' });

      action.next();
      httpMock
        .expectOne((r) => r.method === 'POST' && r.url.endsWith('/birds/data-entries/42/restore/'))
        .flush({ detail: 'Not found.' }, { status: 404, statusText: 'Not Found' });

      // Nichts kam zurück, also gibt es auch nichts nachzuladen.
      expect(refresh.token()).toBe(before);
    });

    it('leaves the entry deleted when the undo window closes unused', async () => {
      await setupForm();
      dialogMock.open.and.returnValue({ afterClosed: () => of(true) });
      // Ein Snackbar, das abläuft oder weggewischt wird, feuert onAction nie.
      spyOn(snackBarOf(fixture), 'open').and.returnValue({ onAction: () => EMPTY } as never);
      spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);

      btn('delete-entry-button')!.click();
      httpMock
        .expectOne((r) => r.method === 'DELETE' && r.url.endsWith('/birds/data-entries/42/'))
        .flush(null, { status: 204, statusText: 'No Content' });

      httpMock.expectNone((r) => r.url.endsWith('/restore/'));
    });

    // ADR 0030: offline wird nicht gelöscht. Der Knopf sperrt sich selbst, statt
    // sich auf die „synchronisiert ⇒ offline read-only"-Regel zu verlassen — die
    // ist heute nur an einer Stelle durchgesetzt und umgehbar (#386).
    it('disables the button while offline and re-enables it on reconnect', async () => {
      await setupForm();
      const connectivity = TestBed.inject(ConnectivityService);
      expect(btn('delete-entry-button')!.disabled).toBe(false);

      connectivity.markOffline();
      fixture.detectChanges();
      expect(btn('delete-entry-button')!.disabled).toBe(true);

      connectivity.markOnline();
      fixture.detectChanges();
      expect(btn('delete-entry-button')!.disabled).toBe(false);
    });
  });
});

// #407 (ADR 0032): the capture form is the only place a half-entered Wiederfang
// exists — there is no autosave and no drafts, and the Beringer entering it is
// holding a bird. So the form publishes its dirty state through
// UnsavedChangesService, and two things outside it now act on that answer: the
// CanDeactivate guard (leaving the form, including the bare `n` shortcut) and
// the nav bar's "Jetzt aktualisieren" (adopting a Version reloads the tab).
// Both throw the input away when the answer is "nothing unsaved here", so these
// tests drive the real guard against a real form: what gets asked, and what
// silently disappears.
describe('DataEntryFormComponent unsaved changes reach the CanDeactivate guard (#407, ADR 0032)', () => {
  let component: DataEntryFormComponent;
  let fixture: ComponentFixture<DataEntryFormComponent>;
  // Two dialogs, deliberately kept apart: the form opens its own (Tot-Fund,
  // Zurücksetzen) through the MatDialog in its component injector, while
  // UnsavedChangesService opens the guard's question through the root one. So a
  // Tot-Fund popup can never be miscounted as "the guard asked".
  const guardDialog = { open: jasmine.createSpy('guardDialog.open') };
  const formDialog = { open: jasmine.createSpy('formDialog.open') };
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  // focusNext() schedules a real setTimeout(50) to advance focus; let it settle
  // so it neither leaks into a later spec nor races the assertions.
  const drainFocusTimers = () => new Promise<void>((resolve) => setTimeout(resolve, 60));

  const project = {
    id: 'p1',
    title: 'Herbst',
    description: '',
    show_optional_fields: true,
    show_net_fields: true,
    projekttyp: Projekttyp.Sonstiges,
    organization: { id: 'o1', handle: 'IWM', name: 'IWM Linz', country: 'AT' },
    default_station: null,
    scientists: [],
    created: '',
    updated: '',
  } as Project;

  async function setup(extraProvider?: Provider): Promise<HttpTestingController> {
    TestBed.resetTestingModule();
    guardDialog.open.calls.reset();
    formDialog.open.calls.reset();
    guardDialog.open.and.returnValue({ afterClosed: () => of(undefined) });
    formDialog.open.and.returnValue({ afterClosed: () => of(undefined) });
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
        { provide: MatDialog, useValue: guardDialog },
        ...(extraProvider ? [extraProvider] : []),
      ],
    })
      .overrideComponent(DataEntryFormComponent, {
        add: { providers: [{ provide: MatDialog, useValue: formDialog }] },
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

  /** A complete saved Fang — complete on purpose: an incomplete one fails the
   * form's validators, and `onSubmit()` would never reach the PUT. */
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
      ringing_station: {
        handle: 'STAMT',
        name: 'Linz, Botanischer Garten',
        organization: { id: 'o1', handle: 'IWM', name: 'IWM Linz', country: 'AT' },
      },
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
      parasites: [],
      has_hunger_stripes: false,
      has_brood_patch: false,
      has_cpl_plus: false,
    } as unknown as DataEntry;
  }

  /** Opens an existing Fang at /data-entry/:id, the mode where a save navigates
   * away rather than resetting. */
  async function setupEditMode(entryId: string): Promise<HttpTestingController> {
    const httpMock = await setup({
      provide: ActivatedRoute,
      useValue: {
        snapshot: { paramMap: { get: (key: string) => (key === 'id' ? entryId : null) } },
      },
    });
    httpMock
      .expectOne((r) => r.method === 'GET' && r.url.endsWith(`/birds/data-entries/${entryId}/`))
      .flush(savedEntry());
    await settle();
    fixture.detectChanges();
    return httpMock;
  }

  // Drive a single-character keyboard shortcut through the MatSelect keydown
  // handler, mimicking a Beringer typing the option key on a focused select —
  // this app's signature keyboard workflow.
  const keyPick = (controlName: string, options: SelectOption<any>[], key: string): void => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    const select = { close: jasmine.createSpy('close') } as unknown as MatSelect;
    component.onSelectKeydown(event, controlName, options, select);
  };

  /** Leaves the form through the **real** guard — exactly what the router runs,
   * whether the navigation came from `n`, a link, or a Version adoption.
   * Answers the ConfirmDialog with `confirm`. */
  async function leaveTheForm(confirm = false): Promise<{ asked: boolean; left: boolean }> {
    guardDialog.open.calls.reset();
    guardDialog.open.and.returnValue({ afterClosed: () => of(confirm) });
    const left = await firstValueFrom(
      TestBed.runInInjectionContext(() =>
        unsavedChangesGuard(null as never, null as never, null as never, null as never),
      ) as Observable<boolean>,
    );
    const asked = guardDialog.open.calls
      .all()
      .some((call) => call.args[0] === ConfirmDialogComponent);
    return { asked, left };
  }

  it('lets an untouched form go without a question', async () => {
    await setup();

    const { asked, left } = await leaveTheForm();

    expect(asked).withContext('nothing entered, nothing to lose').toBeFalse();
    expect(left).toBeTrue();
  });

  // The one-key categorical picks are how this form is actually filled in. They
  // write through setValue(), which — unlike a ControlValueAccessor write — does
  // not mark the form dirty on its own.
  it('asks before an Alter picked by keyboard shortcut is thrown away', async () => {
    await setup();

    keyPick('age_class', component.ageClassOptions, '3');
    expect(component.entryForm.get('age_class')!.value).toBe(AgeClass.ThisYear);

    const { asked, left } = await leaveTheForm();
    expect(asked).withContext('a keyboard-picked Alter is real user input').toBeTrue();
    expect(left).withContext('declining keeps the Beringer on his capture').toBeFalse();

    await drainFocusTimers();
  });

  it('asks before a Geschlecht picked by keyboard shortcut is thrown away', async () => {
    await setup();

    keyPick('sex', component.sexOptions, '1');
    expect(component.entryForm.get('sex')!.value).toBe(Sex.Male);

    const { asked } = await leaveTheForm();
    expect(asked).toBeTrue();

    await drainFocusTimers();
  });

  it('asks before a Nicht-Standard-Fang marker is thrown away', async () => {
    await setup();

    component.onToggleNonStandard();
    expect(component.entryForm.get('is_non_standard')!.value).toBeTrue();

    const { asked } = await leaveTheForm();
    expect(asked).toBeTrue();
  });

  it('asks before a confirmed Tot-Fund is thrown away', async () => {
    await setup();
    formDialog.open.and.returnValue({ afterClosed: () => of('Katze') });

    component.onToggleDeadRecovery();
    await settle();
    expect(component.entryForm.get('is_dead_recovery')!.value).toBeTrue();

    const { asked } = await leaveTheForm();
    expect(asked).withContext('the Todesumstände were typed by a human').toBeTrue();
  });

  it('leaves once the Beringer confirms discarding his input', async () => {
    await setup();
    keyPick('sex', component.sexOptions, '1');

    const { asked, left } = await leaveTheForm(true);

    expect(asked).toBeTrue();
    expect(left).toBeTrue();

    await drainFocusTimers();
  });

  // The other half of the guard's job: it must not nag about work that is
  // already safe. Edit mode is where this bites — the create path resets to a
  // pristine form anyway, but an edit navigates away the moment it is saved, so
  // a form still marked dirty would ask the Beringer to confirm discarding the
  // very input he just saved.
  it('does not ask about input the Beringer has just saved', async () => {
    const httpMock = await setupEditMode('42');

    keyPick('sex', component.sexOptions, '2');
    expect(component.entryForm.dirty).withContext('an edit in progress').toBeTrue();

    // An edit navigates to the list on success; this block registers no routes.
    spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);

    component.onSubmit();
    httpMock
      .expectOne((r) => r.method === 'PUT' && r.url.endsWith('/birds/data-entries/42/'))
      .flush(savedEntry());
    await settle();

    const { asked, left } = await leaveTheForm();
    expect(asked).withContext('it is saved — there is nothing to discard').toBeFalse();
    expect(left).toBeTrue();

    await drainFocusTimers();
  });

  it('stops asking once the capture form is gone', async () => {
    await setup();
    keyPick('sex', component.sexOptions, '1');
    await drainFocusTimers();

    fixture.destroy();

    const { asked, left } = await leaveTheForm();
    expect(asked).withContext('a destroyed form has no input to protect').toBeFalse();
    expect(left).toBeTrue();
  });
});
