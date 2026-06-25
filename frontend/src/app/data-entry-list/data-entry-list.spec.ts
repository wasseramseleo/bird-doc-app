import { LOCALE_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { registerLocaleData } from '@angular/common';
import localeDeAt from '@angular/common/locales/de-AT';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { PageEvent } from '@angular/material/paginator';

import { DataEntryListComponent } from './data-entry-list';

registerLocaleData(localeDeAt);
import { ProjectService } from '../service/project.service';
import { Project } from '../models/project.model';
import { BirdStatus, DataEntry } from '../models/data-entry.model';

describe('DataEntryListComponent', () => {
  let fixture: ComponentFixture<DataEntryListComponent>;
  let component: DataEntryListComponent;
  let httpMock: HttpTestingController;
  let currentProject: ReturnType<typeof signal<Project | null>>;

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

  const project2 = { ...project, id: 'p2', title: 'Frühling' } as Project;

  function row(overrides: Partial<DataEntry>): DataEntry {
    return {
      id: 'e1',
      created: '2026-06-01T08:00:00Z',
      date_time: '2026-06-01T08:00:00Z',
      ring: { id: 'r1', number: '901234', size: 'M' },
      species: { id: 's1', common_name_de: 'Kohlmeise', is_sentinel: false },
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
      row({ id: 'normal', species: { id: 's1', common_name_de: 'Kohlmeise', is_sentinel: false } as never }),
      row({
        id: 'sentinel',
        species: { id: 'sent', common_name_de: 'Ring Vernichtet', is_sentinel: true } as never,
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
});
