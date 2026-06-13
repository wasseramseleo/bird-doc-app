import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';

import { DataEntryFormComponent } from './data-entry-form';
import { BirdStatus, DataEntry } from '../models/data-entry.model';
import { ProjectService } from '../service/project.service';
import { Project } from '../models/project.model';
import { RingingStation } from '../models/ringing-station.model';

describe('DataEntryFormComponent', () => {
  let component: DataEntryFormComponent;
  let fixture: ComponentFixture<DataEntryFormComponent>;

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
});
