import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { ApiService } from './api.service';
import { Scientist } from '../models/scientist.model';

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
});
