import {TestBed} from '@angular/core/testing';

import {IdentityCacheService} from './identity-cache';
import {AuthUser} from '../../models/auth-user.model';

const USER: AuthUser = {
  username: 'fre',
  handle: 'FRE',
  isStaff: false,
  rolle: 'admin',
  organization: {id: 'o1', handle: 'IWM', name: 'IWM Linz', country: 'AT'},
};

describe('IdentityCacheService', () => {
  let service: IdentityCacheService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(IdentityCacheService);
  });

  afterEach(async () => {
    await service.clear();
  });

  it('returns null when nothing was ever cached', async () => {
    const result = await service.load();

    expect(result).toBeNull();
  });

  it('reads back an identity written with save()', async () => {
    await service.save(USER);

    const result = await service.load();

    expect(result).toEqual(USER);
  });
});
