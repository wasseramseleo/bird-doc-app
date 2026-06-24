import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { HomeComponent } from './home';
import { ProjectService } from '../service/project.service';
import { Project } from '../models/project.model';

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

function setup() {
  TestBed.configureTestingModule({
    imports: [HomeComponent],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      provideNoopAnimations(),
    ],
  });
  const fixture: ComponentFixture<HomeComponent> = TestBed.createComponent(HomeComponent);
  const component = fixture.componentInstance;
  const router = TestBed.inject(Router);
  const projectService = TestBed.inject(ProjectService);
  return { fixture, component, router, projectService };
}

describe('HomeComponent', () => {
  // selectProject() persists the chosen Projekt to localStorage via the real
  // ProjectService; clear it so the choice can't leak into other specs (e.g.
  // NavBar rehydrating a stale project under Jasmine's random test order).
  afterEach(() => localStorage.clear());

  it('lands on the data-entry hub when a project is selected', () => {
    const { component, router, projectService } = setup();
    const navigate = spyOn(router, 'navigateByUrl').and.stub();
    const project = makeProject();

    component.selectProject(project);

    expect(navigate).toHaveBeenCalledWith('/data-entries');
    expect(projectService.currentProject()?.id).toBe('p1');
  });
});
