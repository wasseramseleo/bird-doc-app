import {TestBed} from '@angular/core/testing';

import {ConnectivityService} from './connectivity';

describe('ConnectivityService', () => {
  let service: ConnectivityService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ConnectivityService);
  });

  it('starts assuming the app is online', () => {
    expect(service.isOffline()).toBeFalse();
  });

  it('reports offline once markOffline() is called', () => {
    service.markOffline();

    expect(service.isOffline()).toBeTrue();
  });

  it('reports online again once markOnline() is called after an offline period', () => {
    service.markOffline();

    service.markOnline();

    expect(service.isOffline()).toBeFalse();
  });
});
