import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { ApiService } from './api.service';
import { Scientist } from '../models/scientist.model';
import { DataEntry } from '../models/data-entry.model';
import { PaginatedApiResponse } from '../models/paginated-api-response.model';
import { RingSize } from '../models/ring.model';

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

  it('sends feedback via POST /api/feedback/ with the message (not under /birds)', () => {
    service.sendFeedback('Die Ringgröße lässt sich nicht speichern.').subscribe();

    const req = httpMock.expectOne((r) => r.method === 'POST' && r.url.endsWith('/feedback/'));
    expect(req.request.url).not.toContain('/birds/');
    expect(req.request.body).toEqual({ message: 'Die Ringgröße lässt sich nicht speichern.' });
    req.flush(null);
  });
});
