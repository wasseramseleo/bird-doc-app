import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
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
  const projectService = TestBed.inject(ProjectService);
  const httpMock = TestBed.inject(HttpTestingController);
  return { fixture, projectService, httpMock };
}

describe('HomeComponent', () => {
  afterEach(() => localStorage.clear());

  // ADR 0018 + issue #221: `/` is purely the current Projekt's dashboard now. The
  // picker lives at /projekte (ProjectPickerComponent); Home no longer renders it,
  // nor does it fetch projects/organizations/scientists.
  it("renders the current Projekt's dashboard (Letzter Tag card), not a picker", () => {
    const { fixture, projectService, httpMock } = setup();
    const project = makeProject({ id: 'p1', title: 'Schilfgürtel Linz' });
    projectService.setCurrent(project);

    fixture.detectChanges();

    httpMock.expectOne((r) => r.url.endsWith('/projects/p1/stats/')).flush({
      range: { from: '2026-06-26', to: '2026-07-03', preset: 'week' },
      totals: { faenge: 142, artenzahl: 17 },
      top_species: [{ species_id: 'sp-1', name: 'Mönchsgrasmücke', count: 12 }],
      last_fangtag: {
        date: '2026-07-02',
        faenge: 38,
        trend: { previous_fangtag: '2026-06-28', previous_faenge: 25, delta: 13 },
        haeufigste_art: { species_id: 'sp-1', name: 'Mönchsgrasmücke', count: 12 },
        strongest_hour: { hour: 6, count: 9 },
      },
    });
    fixture.detectChanges();

    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('Letzter Tag');
    expect(text).toContain('Mönchsgrasmücke');
    // The picker is not part of Home anymore — it must never render here.
    expect(fixture.nativeElement.querySelector('.project-card')).toBeNull();
  });

  it('renders neither a dashboard nor a picker when no Projekt is current', () => {
    const { fixture, projectService, httpMock } = setup();
    expect(projectService.currentProject()).toBeNull();

    fixture.detectChanges();

    // No dashboard, no picker, and no stray requests (the picker is at /projekte).
    expect(fixture.nativeElement.querySelector('app-project-dashboard')).toBeNull();
    expect(fixture.nativeElement.querySelector('.project-card')).toBeNull();
    httpMock.verify();
  });
});
