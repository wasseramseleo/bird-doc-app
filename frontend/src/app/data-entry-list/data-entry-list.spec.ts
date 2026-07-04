import { LOCALE_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { registerLocaleData } from '@angular/common';
import localeDeAt from '@angular/common/locales/de-AT';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { PageEvent } from '@angular/material/paginator';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';

import { DataEntryListComponent } from './data-entry-list';

registerLocaleData(localeDeAt);
import { ProjectService } from '../service/project.service';
import { Project, Projekttyp } from '../models/project.model';
import { BirdStatus, DataEntry } from '../models/data-entry.model';

describe('DataEntryListComponent', () => {
  let fixture: ComponentFixture<DataEntryListComponent>;
  let component: DataEntryListComponent;
  let httpMock: HttpTestingController;
  let currentProject: ReturnType<typeof signal<Project | null>>;
  let dialog: jasmine.SpyObj<MatDialog>;

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

  const project2 = { ...project, id: 'p2', title: 'Frühling' } as Project;

  function row(overrides: Partial<DataEntry>): DataEntry {
    return {
      id: 'e1',
      created: '2026-06-01T08:00:00Z',
      date_time: '2026-06-01T08:00:00Z',
      ring: { id: 'r1', number: '901234', size: 'M' },
      species: { id: 's1', common_name_de: 'Kohlmeise', special_kind: '' },
      bird_status: BirdStatus.FirstCatch,
      staff: { id: 'p1', handle: 'FRE', full_name: 'Filip Reiter' },
      tarsus: 19,
      feather_span: 54,
      wing_span: 73,
      weight_gram: 18,
      ...overrides,
    } as unknown as DataEntry;
  }

  beforeEach(async () => {
    currentProject = signal<Project | null>(project);
    dialog = jasmine.createSpyObj('MatDialog', ['open']);

    await TestBed.configureTestingModule({
      imports: [DataEntryListComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        { provide: LOCALE_ID, useValue: 'de-AT' },
        {
          provide: ProjectService,
          useValue: { currentProject, setCurrent: () => {}, clear: () => {} },
        },
        { provide: MatDialog, useValue: dialog },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DataEntryListComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  // Flush the next outstanding list request and return it so callers can assert
  // on its query params (page, search) before/after flushing.
  function flushEntries(entries: DataEntry[]) {
    const req = httpMock.expectOne((r) => r.method === 'GET' && r.url.endsWith('/data-entries/'));
    req.flush({ count: entries.length, next: null, previous: null, results: entries });
    fixture.detectChanges();
    return req;
  }

  it('marks a sentinel "Ring Vernichtet" row discreetly and leaves normal rows unmarked', () => {
    flushEntries([
      row({ id: 'normal', species: { id: 's1', common_name_de: 'Kohlmeise', special_kind: '' } as never }),
      row({
        id: 'sentinel',
        species: { id: 'sent', common_name_de: 'Ring Vernichtet', special_kind: 'ring_destroyed' } as never,
        bird_status: null as never,
        tarsus: null as never,
      }),
    ]);

    const rows = Array.from(fixture.nativeElement.querySelectorAll('tr.entry-row')) as HTMLElement[];
    expect(rows.length).toBe(2);

    const sentinelRows = rows.filter((r) => r.classList.contains('entry-row--sentinel'));
    expect(sentinelRows.length).toBe(1);

    // The marked row carries a discreet "vernichtet" badge.
    expect(sentinelRows[0].textContent).toContain('vernichtet');
  });

  it('renders biometric values with one decimal place in de-AT format', () => {
    flushEntries([row({ tarsus: 12.54, feather_span: 54, wing_span: 73.25, weight_gram: 18.96 })]);

    const cells = Array.from(
      fixture.nativeElement.querySelectorAll('tr.entry-row td'),
    ) as HTMLElement[];
    const text = cells.map((c) => c.textContent?.trim()).join('|');

    // One decimal place, rounded, Austrian comma — display only.
    expect(text).toContain('12,5');
    expect(text).toContain('54,0');
    expect(text).toContain('73,3');
    expect(text).toContain('19,0');
  });

  it('keeps the full ringer name in the main list', () => {
    flushEntries([row({ staff: { id: 'p1', handle: 'FRE', full_name: 'Filip Reiter' } as never })]);

    const staffCell = fixture.nativeElement.querySelector(
      'tr.entry-row td.mat-column-staff',
    ) as HTMLElement;
    expect(staffCell.textContent!.trim()).toBe('Filip Reiter');
  });

  it('fetches the list exactly once on first render', () => {
    // expectOne throws if a second request was queued, so this proves the
    // initial load is not duplicated by both ngOnInit and the reactive path.
    flushEntries([row({})]);
    httpMock.verify();
  });

  it('reloads the list for the new Projekt when the active-Projekt signal changes', () => {
    const first = flushEntries([row({ id: 'p1-row' })]);
    expect(first.request.params.get('project')).toBe('p1');

    currentProject.set(project2);
    fixture.detectChanges();

    // A fresh request goes out for the new Projekt — no stale data is kept.
    const second = flushEntries([row({ id: 'p2-row' })]);
    expect(second.request.params.get('project')).toBe('p2');
    expect(component.entries().map((e) => e.id)).toEqual(['p2-row']);
  });

  it('resets to the first page on Projekt switch', () => {
    flushEntries([row({})]);

    // Move off the first page like a user paging through the list.
    component.onPageChange({ pageIndex: 2, pageSize: 10, length: 0 } as PageEvent);
    const paged = flushEntries([row({})]);
    expect(paged.request.params.get('page')).toBe('3'); // API is one-based
    expect(component.pageIndex()).toBe(2);

    currentProject.set(project2);
    fixture.detectChanges();

    const afterSwitch = flushEntries([row({})]);
    expect(component.pageIndex()).toBe(0);
    expect(afterSwitch.request.params.get('page')).toBe('1');
  });

  function importButton(): HTMLButtonElement {
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ) as HTMLButtonElement[];
    return buttons.find((b) => b.textContent?.includes('Import'))!;
  }

  it('enables the Import button only once a Projekt is selected', () => {
    flushEntries([row({})]);
    // A Projekt is active (the default fixture): the button is live.
    expect(importButton().disabled).toBeFalse();

    // Without a selected Projekt there is no unambiguous target, so it is disabled.
    currentProject.set(null);
    fixture.detectChanges();
    expect(importButton().disabled).toBeTrue();
  });

  it('opens the import dialog for the active Projekt and refreshes the list after a commit', () => {
    flushEntries([row({ id: 'before-import' })]);

    dialog.open.and.returnValue({ afterClosed: () => of(true) } as never);
    importButton().click();

    expect(dialog.open).toHaveBeenCalled();
    const data = dialog.open.calls.mostRecent().args[1]?.data as { projectId: string };
    expect(data.projectId).toBe('p1');

    // A committed import refreshes the capture list so the new Fänge appear.
    const reload = flushEntries([row({ id: 'after-import' })]);
    expect(reload.request.params.get('project')).toBe('p1');
    expect(component.entries().map((e) => e.id)).toEqual(['after-import']);
  });

  it('does not refresh the list when the import dialog is cancelled', () => {
    flushEntries([row({})]);

    dialog.open.and.returnValue({ afterClosed: () => of(false) } as never);
    component.openImport();

    // Cancelling wrote nothing, so no reload request is issued.
    httpMock.verify();
  });

  it('clears the search box on Projekt switch', () => {
    flushEntries([row({})]);

    // Simulate a pending species filter from the previous Projekt.
    component.searchControl.setValue('Kohlmeise');

    currentProject.set(project2);
    fixture.detectChanges();

    const afterSwitch = flushEntries([row({})]);
    expect(component.searchControl.value).toBe('');
    expect(afterSwitch.request.params.has('search')).toBe(false);
  });

  // Issue #339: the "Neuer Eintrag" button carries a discoverability hint for the
  // app-wide "n" shortcut so the keystroke is learnable from the UI.
  it('shows a visible "(n)" shortcut hint on the Neuer Eintrag button', () => {
    flushEntries([row({})]);

    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ) as HTMLButtonElement[];
    const newEntryButton = buttons.find((b) => b.textContent?.includes('Neuer Eintrag'));

    expect(newEntryButton).withContext('Neuer Eintrag button exists').toBeTruthy();
    expect(newEntryButton!.textContent).toContain('(n)');
  });
});
