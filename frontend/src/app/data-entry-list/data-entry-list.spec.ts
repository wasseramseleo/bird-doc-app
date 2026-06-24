import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { DataEntryListComponent } from './data-entry-list';
import { ProjectService } from '../service/project.service';
import { Project } from '../models/project.model';
import { BirdStatus, DataEntry } from '../models/data-entry.model';

describe('DataEntryListComponent', () => {
  let fixture: ComponentFixture<DataEntryListComponent>;
  let httpMock: HttpTestingController;

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
    await TestBed.configureTestingModule({
      imports: [DataEntryListComponent],
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
    }).compileComponents();

    fixture = TestBed.createComponent(DataEntryListComponent);
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  function flushEntries(entries: DataEntry[]) {
    httpMock
      .expectOne((r) => r.method === 'GET' && r.url.endsWith('/data-entries/'))
      .flush({ count: entries.length, next: null, previous: null, results: entries });
    fixture.detectChanges();
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
});
