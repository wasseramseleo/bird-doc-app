import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';

import { projectSelectedGuard } from './project-selected.guard';
import { ProjectService } from '../../service/project.service';
import { Project } from '../../models/project.model';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    title: 'Schilfgürtel Linz',
    description: '',
    show_optional_fields: false,
    organization: { id: 'o1', name: 'IWM Linz' } as Project['organization'],
    default_station: null,
    scientists: [],
    created: '2026-06-01T00:00:00Z',
    updated: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

function runGuard(): boolean | UrlTree {
  return TestBed.runInInjectionContext(() =>
    projectSelectedGuard(null as never, { url: '/' } as never),
  ) as boolean | UrlTree;
}

describe('projectSelectedGuard', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  // setCurrent persists to localStorage via the real ProjectService; clear it so
  // a set Projekt can't rehydrate into a later spec (Jasmine randomises order).
  afterEach(() => localStorage.clear());

  it('lets / through when a Projekt is current (the dashboard, ADR 0018)', () => {
    TestBed.inject(ProjectService).setCurrent(makeProject());

    expect(runGuard()).toBeTrue();
  });

  it('redirects / to the /projekte picker when no Projekt is current', () => {
    expect(TestBed.inject(ProjectService).currentProject()).toBeNull();

    const result = runGuard();

    expect(result).toEqual(TestBed.inject(Router).createUrlTree(['/projekte']));
  });
});
