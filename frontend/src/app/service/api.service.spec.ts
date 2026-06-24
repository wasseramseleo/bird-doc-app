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

  it('getNextRingNumber scopes the suggestion to the given project', () => {
    let result: number | undefined;

    service.getNextRingNumber(RingSize.V, 'proj-1').subscribe((r) => (result = r.next_number));

    const req = httpMock.expectOne(
      (r) => r.method === 'GET' && r.url.endsWith('/birds/rings/next-number/'),
    );
    expect(req.request.params.get('size')).toBe('V');
    expect(req.request.params.get('project')).toBe('proj-1');
    req.flush({ next_number: 42 });

    expect(result).toBe(42);
  });

  it('getNextRingNumber omits the project param when none is given', () => {
    service.getNextRingNumber(RingSize.V).subscribe();

    const req = httpMock.expectOne(
      (r) => r.method === 'GET' && r.url.endsWith('/birds/rings/next-number/'),
    );
    expect(req.request.params.get('size')).toBe('V');
    expect(req.request.params.has('project')).toBe(false);
    req.flush({ next_number: 1 });
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
});
