import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { NavBar } from './nav-bar';
import { ProjectService } from '../service/project.service';
import { Project } from '../models/project.model';

function makeProject(): Project {
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
  };
}

function setup() {
  TestBed.configureTestingModule({
    imports: [NavBar],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      provideNoopAnimations(),
    ],
  });
  const fixture: ComponentFixture<NavBar> = TestBed.createComponent(NavBar);
  const projectService = TestBed.inject(ProjectService);
  return { fixture, projectService };
}

describe('NavBar', () => {
  afterEach(() => localStorage.clear());

  it('should create', () => {
    const { fixture } = setup();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('shows the active project title and a Letzte Fänge link to the hub', () => {
    const { fixture, projectService } = setup();
    projectService.setCurrent(makeProject());
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Schilfgürtel Linz');

    const hubLink = el.querySelector('a[href="/data-entries"]');
    expect(hubLink).withContext('Letzte Fänge link to /data-entries').not.toBeNull();
    expect(hubLink?.textContent).toContain('Letzte Fänge');
  });

  it('shows neither the project context nor the hub link when no project is active', () => {
    const { fixture, projectService } = setup();
    expect(projectService.currentProject()).toBeNull();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.project-context')).toBeNull();
    expect(el.querySelector('a[href="/data-entries"]')).toBeNull();
  });
});
