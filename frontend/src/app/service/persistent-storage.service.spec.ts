import {TestBed} from '@angular/core/testing';

import {PersistentStorageService} from './persistent-storage.service';

describe('PersistentStorageService', () => {
  it('requests persistent storage on construction and reports the granted state', async () => {
    spyOn(navigator.storage, 'persist').and.resolveTo(true);

    const service = TestBed.inject(PersistentStorageService);
    await service.ready;

    expect(navigator.storage.persist).toHaveBeenCalled();
    expect(service.state()).toBe('granted');
  });

  it('reports the denied state when the browser refuses persistence', async () => {
    spyOn(navigator.storage, 'persist').and.resolveTo(false);

    const service = TestBed.inject(PersistentStorageService);
    await service.ready;

    expect(service.state()).toBe('denied');
  });

  it('starts in the pending state before the request settles', () => {
    let resolvePersist!: (granted: boolean) => void;
    spyOn(navigator.storage, 'persist').and.returnValue(
      new Promise<boolean>((resolve) => (resolvePersist = resolve)),
    );

    const service = TestBed.inject(PersistentStorageService);

    expect(service.state()).toBe('pending');
    resolvePersist(true);
  });

  it('treats a rejected request as denied rather than throwing', async () => {
    spyOn(navigator.storage, 'persist').and.rejectWith(new Error('blocked'));
    spyOn(console, 'error');

    const service = TestBed.inject(PersistentStorageService);
    await service.ready;

    expect(service.state()).toBe('denied');
  });

  it('reports unsupported when the browser has no Storage Manager API', async () => {
    const realStorage = navigator.storage;
    Object.defineProperty(navigator, 'storage', {value: undefined, configurable: true});

    try {
      const service = TestBed.inject(PersistentStorageService);
      await service.ready;

      expect(service.state()).toBe('unsupported');
    } finally {
      Object.defineProperty(navigator, 'storage', {value: realStorage, configurable: true});
    }
  });
});
