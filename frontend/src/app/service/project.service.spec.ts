import {TestBed} from '@angular/core/testing';

import {ProjectService} from './project.service';
import {WorkbenchStorageService} from './workbench-storage.service';
import {Project} from '../models/project.model';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    title: 'Linz, Botanischer Garten',
    description: '',
    show_optional_fields: true,
    organization: {id: 'o1', handle: 'IWM', name: 'IWM Linz', country: 'AT'},
    scientists: [],
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('ProjectService', () => {
  function configure(storage: Partial<WorkbenchStorageService>): {
    service: ProjectService;
    storage: jasmine.SpyObj<WorkbenchStorageService>;
  } {
    const spy = jasmine.createSpyObj<WorkbenchStorageService>('WorkbenchStorageService', [
      'loadCurrentProject',
      'saveCurrentProject',
      'loadLastBeringer',
      'saveLastBeringer',
    ]);
    spy.loadCurrentProject.and.returnValue(storage.loadCurrentProject?.() ?? null);

    TestBed.configureTestingModule({
      providers: [ProjectService, {provide: WorkbenchStorageService, useValue: spy}],
    });

    return {service: TestBed.inject(ProjectService), storage: spy};
  }

  it('rehydrates the current Projekt from storage on construction', () => {
    const stored = makeProject();
    const {service} = configure({loadCurrentProject: () => stored});

    expect(service.currentProject()).toEqual(stored);
  });

  it('starts with no current Projekt when storage is empty', () => {
    const {service} = configure({loadCurrentProject: () => null});

    expect(service.currentProject()).toBeNull();
  });

  it('persists the Projekt through storage when one is selected', () => {
    const {service, storage} = configure({loadCurrentProject: () => null});
    const project = makeProject();

    service.setCurrent(project);

    expect(service.currentProject()).toEqual(project);
    expect(storage.saveCurrentProject).toHaveBeenCalledWith(project);
  });

  it('clears the stored Projekt when cleared', () => {
    const {service, storage} = configure({loadCurrentProject: () => makeProject()});

    service.clear();

    expect(service.currentProject()).toBeNull();
    expect(storage.saveCurrentProject).toHaveBeenCalledWith(null);
  });
});
