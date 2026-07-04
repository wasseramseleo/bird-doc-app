import {TestBed} from '@angular/core/testing';
import {of} from 'rxjs';

import {ProjectService} from './project.service';
import {WorkbenchStorageService} from './workbench-storage.service';
import {ApiService} from './api.service';
import {Project, Projekttyp} from '../models/project.model';
import {PaginatedApiResponse} from '../models/paginated-api-response.model';

function page0(results: Project[]): PaginatedApiResponse<Project> {
  return {count: results.length, next: null, previous: null, results};
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    title: 'Linz, Botanischer Garten',
    description: '',
    show_optional_fields: true,
    show_net_fields: true,
    projekttyp: Projekttyp.Sonstiges,
    organization: {id: 'o1', handle: 'IWM', name: 'IWM Linz', country: 'AT'},
    default_station: null,
    scientists: [],
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('ProjectService', () => {
  function configure(
    storage: Partial<WorkbenchStorageService>,
    projects: Project[] = [],
  ): {
    service: ProjectService;
    storage: jasmine.SpyObj<WorkbenchStorageService>;
    api: jasmine.SpyObj<ApiService>;
  } {
    const spy = jasmine.createSpyObj<WorkbenchStorageService>('WorkbenchStorageService', [
      'loadCurrentProject',
      'saveCurrentProject',
      'loadLastBeringer',
      'saveLastBeringer',
    ]);
    spy.loadCurrentProject.and.returnValue(storage.loadCurrentProject?.() ?? null);

    const api = jasmine.createSpyObj<ApiService>('ApiService', ['getProjects']);
    api.getProjects.and.returnValue(of(page0(projects)));

    TestBed.configureTestingModule({
      providers: [
        ProjectService,
        {provide: WorkbenchStorageService, useValue: spy},
        {provide: ApiService, useValue: api},
      ],
    });

    return {service: TestBed.inject(ProjectService), storage: spy, api};
  }

  it('exposes an empty project list before it is loaded', () => {
    const {service} = configure({loadCurrentProject: () => null});

    expect(service.projects()).toEqual([]);
  });

  it('loads the project list from the projects endpoint as a shared source', () => {
    const a = makeProject({id: 'p1', title: 'Linz'});
    const b = makeProject({id: 'p2', title: 'Wien'});
    const {service, api} = configure({loadCurrentProject: () => null}, [a, b]);

    service.loadProjects().subscribe();

    expect(api.getProjects).toHaveBeenCalledTimes(1);
    expect(service.projects()).toEqual([a, b]);
  });

  it('prepends a newly created project to the shared list', () => {
    const existing = makeProject({id: 'p1', title: 'Linz'});
    const {service} = configure({loadCurrentProject: () => null}, [existing]);
    service.loadProjects().subscribe();

    const created = makeProject({id: 'p2', title: 'Wien'});
    service.upsertProject(created);

    expect(service.projects()).toEqual([created, existing]);
  });

  it('replaces an edited project in place in the shared list', () => {
    const a = makeProject({id: 'p1', title: 'Linz'});
    const b = makeProject({id: 'p2', title: 'Wien'});
    const {service} = configure({loadCurrentProject: () => null}, [a, b]);
    service.loadProjects().subscribe();

    const editedA = makeProject({id: 'p1', title: 'Linz, Botanischer Garten'});
    service.upsertProject(editedA);

    expect(service.projects()).toEqual([editedA, b]);
  });

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
