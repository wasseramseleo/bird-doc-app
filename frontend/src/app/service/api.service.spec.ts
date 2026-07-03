import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { ApiService } from './api.service';
import { Scientist } from '../models/scientist.model';
import { DataEntry } from '../models/data-entry.model';
import { PaginatedApiResponse } from '../models/paginated-api-response.model';
import { RingSize } from '../models/ring.model';
import { ProjectStats } from '../models/project-stats.model';

describe('ApiService', () => {
  let service: ApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('creates a Beringer via POST /scientists/ and returns the created record', () => {
    const created: Scientist = { id: '1', handle: 'FRE', full_name: 'Filip Reiter' };
    let result: Scientist | undefined;

    service
      .createScientist({ first_name: 'Filip', last_name: 'Reiter', handle: 'FRE' })
      .subscribe((s) => (result = s));

    const req = httpMock.expectOne(
      (r) => r.method === 'POST' && r.url.endsWith('/birds/scientists/'),
    );
    expect(req.request.body).toEqual({ first_name: 'Filip', last_name: 'Reiter', handle: 'FRE' });
    req.flush(created);

    expect(result).toEqual(created);
  });

  it('getNextRingNumber scopes the suggestion to the given project and preserves the string verbatim', () => {
    let result: string | null | undefined;

    service.getNextRingNumber(RingSize.V, 'proj-1').subscribe((r) => (result = r.next_number));

    const req = httpMock.expectOne(
      (r) => r.method === 'GET' && r.url.endsWith('/birds/rings/next-number/'),
    );
    expect(req.request.params.get('size')).toBe('V');
    expect(req.request.params.get('project')).toBe('proj-1');
    req.flush({ next_number: '0043' });

    expect(result).toBe('0043');
  });

  it('getNextRingNumber surfaces a null suggestion when there is none', () => {
    let result: string | null | undefined;

    service.getNextRingNumber(RingSize.V).subscribe((r) => (result = r.next_number));

    const req = httpMock.expectOne(
      (r) => r.method === 'GET' && r.url.endsWith('/birds/rings/next-number/'),
    );
    expect(req.request.params.get('size')).toBe('V');
    expect(req.request.params.has('project')).toBe(false);
    req.flush({ next_number: null });

    expect(result).toBeNull();
  });

  it('getSpecies scopes the species query to the given project', () => {
    service.getSpecies('Ams', 'proj-1').subscribe();

    const req = httpMock.expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/species/'));
    expect(req.request.params.get('search')).toBe('Ams');
    expect(req.request.params.get('project')).toBe('proj-1');
    req.flush({ count: 0, next: null, previous: null, results: [] });
  });

  it('getSpecies omits the project param when none is given', () => {
    service.getSpecies('').subscribe();

    const req = httpMock.expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/species/'));
    expect(req.request.params.has('project')).toBe(false);
    req.flush({ count: 0, next: null, previous: null, results: [] });
  });

  it('getDataEntries issues a project-scoped paginated request and maps the response', () => {
    const response: PaginatedApiResponse<DataEntry> = {
      count: 1,
      next: null,
      previous: null,
      results: [{ id: 'entry-1' } as DataEntry],
    };
    let result: PaginatedApiResponse<DataEntry> | undefined;

    service
      .getDataEntries({ projectId: 'proj-1', page: 2, pageSize: 50, search: 'Amsel' })
      .subscribe((r) => (result = r));

    const req = httpMock.expectOne(
      (r) => r.method === 'GET' && r.url.endsWith('/birds/data-entries/'),
    );
    expect(req.request.params.get('project')).toBe('proj-1');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('page_size')).toBe('50');
    expect(req.request.params.get('search')).toBe('Amsel');
    req.flush(response);

    expect(result).toEqual(response);
  });

  it('getProjectStats hits the project stats action with the range params and maps the typed payload', () => {
    const stats: ProjectStats = {
      range: { from: '2026-06-26', to: '2026-07-03', preset: 'week' },
      totals: { faenge: 142, artenzahl: 17 },
      top_species: [
        { species_id: 'sp-1', name: 'Mönchsgrasmücke', count: 34 },
        { species_id: 'sp-2', name: 'Amsel', count: 21 },
      ],
      series: {
        days: ['2026-06-26', '2026-07-02'],
        lines: [
          { species_id: 'sp-1', name: 'Mönchsgrasmücke', counts: [16, 18] },
          { species_id: null, name: 'Übrige', counts: [7, 10] },
        ],
      },
      last_fangtag: {
        date: '2026-07-02',
        faenge: 38,
        trend: { previous_fangtag: '2026-06-28', previous_faenge: 25, delta: 13 },
        haeufigste_art: { species_id: 'sp-1', name: 'Mönchsgrasmücke', count: 12 },
        strongest_hour: { hour: 6, count: 9 },
      },
    };
    let result: ProjectStats | undefined;

    service
      .getProjectStats('proj-1', { preset: 'week', from: '2026-06-26', to: '2026-07-03' })
      .subscribe((s) => (result = s));

    const req = httpMock.expectOne(
      (r) => r.method === 'GET' && r.url.endsWith('/birds/projects/proj-1/stats/'),
    );
    expect(req.request.params.get('preset')).toBe('week');
    expect(req.request.params.get('from')).toBe('2026-06-26');
    expect(req.request.params.get('to')).toBe('2026-07-03');
    req.flush(stats);

    expect(result).toEqual(stats);
    expect(result?.last_fangtag?.haeufigste_art?.name).toBe('Mönchsgrasmücke');
    // top_species maps through, preserving the häufigste-Arten order.
    expect(result?.top_species.map((s) => s.name)).toEqual(['Mönchsgrasmücke', 'Amsel']);
    expect(result?.top_species[0].count).toBe(34);
  });

  it('getProjectStats omits range params when none are given', () => {
    service.getProjectStats('proj-1').subscribe();

    const req = httpMock.expectOne(
      (r) => r.method === 'GET' && r.url.endsWith('/birds/projects/proj-1/stats/'),
    );
    expect(req.request.params.has('preset')).toBeFalse();
    expect(req.request.params.has('from')).toBeFalse();
    expect(req.request.params.has('to')).toBeFalse();
    req.flush({
      range: { from: null, to: '2026-07-03', preset: 'week' },
      totals: { faenge: 0, artenzahl: 0 },
      top_species: [],
      series: { days: [], lines: [] },
      last_fangtag: null,
    } as ProjectStats);
  });

  it('getRingingStations requests archived + active via include_archived=true when asked', () => {
    service.getRingingStations(undefined, undefined, true).subscribe();

    const req = httpMock.expectOne(
      (r) => r.method === 'GET' && r.url.endsWith('/birds/ringing-stations/'),
    );
    expect(req.request.params.get('include_archived')).toBe('true');
    req.flush({ count: 0, next: null, previous: null, results: [] });
  });

  it('getRingingStations omits include_archived by default (active only)', () => {
    service.getRingingStations(undefined, 'ORG').subscribe();

    const req = httpMock.expectOne(
      (r) => r.method === 'GET' && r.url.endsWith('/birds/ringing-stations/'),
    );
    expect(req.request.params.has('include_archived')).toBeFalse();
    expect(req.request.params.get('organization')).toBe('ORG');
    req.flush({ count: 0, next: null, previous: null, results: [] });
  });

  it('createRingingStation POSTs the payload without a handle', () => {
    service
      .createRingingStation({
        name: 'Teichwiese',
        place_code: 'AT-TW',
        latitude: '48.1',
        longitude: '16.3',
        region: 'Wien',
      })
      .subscribe();

    const req = httpMock.expectOne(
      (r) => r.method === 'POST' && r.url.endsWith('/birds/ringing-stations/'),
    );
    expect(req.request.body).toEqual({
      name: 'Teichwiese',
      place_code: 'AT-TW',
      latitude: '48.1',
      longitude: '16.3',
      region: 'Wien',
    });
    expect('handle' in (req.request.body as object)).toBeFalse();
    req.flush({});
  });

  it('updateRingingStation PATCHes the handle route with the changed fields', () => {
    service.updateRingingStation('teichwiese', { name: 'Neu' }).subscribe();

    const req = httpMock.expectOne(
      (r) => r.method === 'PATCH' && r.url.endsWith('/birds/ringing-stations/teichwiese/'),
    );
    expect(req.request.body).toEqual({ name: 'Neu' });
    req.flush({});
  });

  it('setRingingStationActive archives via PATCH {is_active:false}', () => {
    service.setRingingStationActive('teichwiese', false).subscribe();

    const req = httpMock.expectOne(
      (r) => r.method === 'PATCH' && r.url.endsWith('/birds/ringing-stations/teichwiese/'),
    );
    expect(req.request.body).toEqual({ is_active: false });
    req.flush({});
  });

  it('deleteRingingStation issues DELETE on the handle route', () => {
    service.deleteRingingStation('teichwiese').subscribe();

    const req = httpMock.expectOne(
      (r) => r.method === 'DELETE' && r.url.endsWith('/birds/ringing-stations/teichwiese/'),
    );
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('getAllMitgliedschaften follows the DRF next link across every page', () => {
    let result: { id: string }[] | undefined;

    service.getAllMitgliedschaften().subscribe((r) => (result = r as { id: string }[]));

    const first = httpMock.expectOne(
      (r) => r.method === 'GET' && r.url.endsWith('/birds/mitgliedschaften/'),
    );
    first.flush({
      count: 2,
      next: 'http://localhost:8000/api/birds/mitgliedschaften/?page=2',
      previous: null,
      results: [{ id: 'a' }],
    });

    const second = httpMock.expectOne((r) => r.method === 'GET' && r.urlWithParams.includes('page=2'));
    second.flush({ count: 2, next: null, previous: null, results: [{ id: 'b' }] });

    // The pages are concatenated into one flat list — nothing beyond page one is lost.
    expect((result ?? []).map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('sends feedback via POST /api/feedback/ with the message (not under /birds)', () => {
    service.sendFeedback('Die Ringgröße lässt sich nicht speichern.').subscribe();

    const req = httpMock.expectOne((r) => r.method === 'POST' && r.url.endsWith('/feedback/'));
    expect(req.request.url).not.toContain('/birds/');
    expect(req.request.body).toEqual({ message: 'Die Ringgröße lässt sich nicht speichern.' });
    req.flush(null);
  });

  it('importIwmDryRun POSTs the file as multipart to the project import route (no commit)', () => {
    const file = new File(['xlsx-bytes'], 'meldung.xlsx');

    service.importIwmDryRun('proj-1', file).subscribe();

    const req = httpMock.expectOne(
      (r) => r.method === 'POST' && r.url.endsWith('/birds/projects/proj-1/import-iwm/'),
    );
    const body = req.request.body as FormData;
    expect(body instanceof FormData).toBeTrue();
    expect(body.get('file')).toBe(file);
    // A dry-run must not carry the commit flag, or it would write.
    expect(body.has('commit')).toBeFalse();
    req.flush({ importable: 0, duplicates: 0, errors: [], warnings: [], toCreate: { beringer: [], stationen: [] }, cap: { limit: 5000, exceeded: false } });
  });

  it('importIwmCommit POSTs the file with commit=true as multipart', () => {
    const file = new File(['xlsx-bytes'], 'meldung.xlsx');

    service.importIwmCommit('proj-1', file).subscribe();

    const req = httpMock.expectOne(
      (r) => r.method === 'POST' && r.url.endsWith('/birds/projects/proj-1/import-iwm/'),
    );
    const body = req.request.body as FormData;
    expect(body instanceof FormData).toBeTrue();
    expect(body.get('file')).toBe(file);
    expect(body.get('commit')).toBe('true');
    req.flush({ created: 0, duplicatesSkipped: 0, errors: [], createdBeringer: [], createdStationen: [] });
  });
});
