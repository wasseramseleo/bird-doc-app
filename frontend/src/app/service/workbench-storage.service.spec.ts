import {TestBed} from '@angular/core/testing';

import {WorkbenchStorageService} from './workbench-storage.service';
import {Project, Projekttyp} from '../models/project.model';
import {Scientist} from '../models/scientist.model';

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

function makeBeringer(overrides: Partial<Scientist> = {}): Scientist {
  return {id: 's1', handle: 'FRE', full_name: 'Filip Reiter', ...overrides};
}

describe('WorkbenchStorageService', () => {
  let service: WorkbenchStorageService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(WorkbenchStorageService);
  });

  afterEach(() => localStorage.clear());

  describe('current Projekt', () => {
    it('round-trips the saved Projekt through storage', () => {
      const project = makeProject();

      service.saveCurrentProject(project);

      expect(service.loadCurrentProject()).toEqual(project);
    });

    it('returns null when no Projekt has been stored', () => {
      expect(service.loadCurrentProject()).toBeNull();
    });

    it('returns null when the stored value is corrupt', () => {
      localStorage.setItem('birddoc.currentProject', '{not valid json');

      expect(service.loadCurrentProject()).toBeNull();
    });

    it('clears the stored Projekt when saved with null', () => {
      service.saveCurrentProject(makeProject());

      service.saveCurrentProject(null);

      expect(service.loadCurrentProject()).toBeNull();
    });
  });

  describe('beta banner dismissal', () => {
    it('reports the banner as not dismissed before anything is stored', () => {
      expect(service.loadBetaBannerDismissed()).toBeFalse();
    });

    it('remembers the dismissal once saved', () => {
      service.saveBetaBannerDismissed();

      expect(service.loadBetaBannerDismissed()).toBeTrue();
    });
  });

  describe('last Beringer per Projekt', () => {
    it('round-trips the last Beringer for a Projekt', () => {
      const beringer = makeBeringer();

      service.saveLastBeringer('p1', beringer);

      expect(service.loadLastBeringer('p1')).toEqual(beringer);
    });

    it('keeps each Projekt’s Beringer isolated from the others', () => {
      const reiter = makeBeringer({id: 's1', handle: 'FRE', full_name: 'Filip Reiter'});
      const mueller = makeBeringer({id: 's2', handle: 'JMU', full_name: 'Jana Müller'});

      service.saveLastBeringer('p1', reiter);
      service.saveLastBeringer('p2', mueller);

      expect(service.loadLastBeringer('p1')).toEqual(reiter);
      expect(service.loadLastBeringer('p2')).toEqual(mueller);
    });

    it('returns null for a Projekt with no remembered Beringer', () => {
      service.saveLastBeringer('p1', makeBeringer());

      expect(service.loadLastBeringer('unknown')).toBeNull();
    });
  });
});
