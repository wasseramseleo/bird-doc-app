import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { HomeComponent } from './home';
import { ProjectService } from '../service/project.service';
import { Project } from '../models/project.model';

function page0<T>(results: T[]) {
  return { count: results.length, next: null, previous: null, results };
}

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
  const httpMock = TestBed.inject(HttpTestingController);
  return { fixture, component, router, projectService, httpMock };
}

describe('HomeComponent', () => {
  // selectProject() persists the chosen Projekt to localStorage via the real
  // ProjectService; clear it so the choice can't leak into other specs (e.g.
  // NavBar rehydrating a stale project under Jasmine's random test order).
  afterEach(() => localStorage.clear());

  it('renders project cards from the shared ProjectService list', () => {
    const { fixture, projectService, httpMock } = setup();
    const projects = [
      makeProject({ id: 'p1', title: 'Schilfgürtel Linz' }),
      makeProject({ id: 'p2', title: 'Donau-Auen' }),
    ];

    fixture.detectChanges(); // triggers ngOnInit → loads via ProjectService

    httpMock.expectOne((r) => r.url.endsWith('/projects/')).flush(page0(projects));
    httpMock.expectOne((r) => r.url.endsWith('/organizations/')).flush(page0([]));
    httpMock.expectOne((r) => r.url.endsWith('/scientists/')).flush(page0([]));
    fixture.detectChanges();

    // The shared service is the source of truth Home renders from.
    expect(projectService.projects()).toEqual(projects);
    const titles = Array.from(
      fixture.nativeElement.querySelectorAll('.project-card__title'),
    ).map((el) => (el as HTMLElement).textContent?.trim());
    expect(titles).toEqual(['Schilfgürtel Linz', 'Donau-Auen']);
  });

  it('renders the current project dashboard (Letzter Tag card), not the picker, when a project is current', () => {
    const { fixture, projectService, httpMock } = setup();
    const project = makeProject({ id: 'p1', title: 'Schilfgürtel Linz' });
    // A persisted current Projekt (as after a reload — ADR 0018).
    projectService.setCurrent(project);

    fixture.detectChanges(); // ngOnInit loads projects/orgs/scientists; dashboard loads stats

    httpMock.expectOne((r) => r.url.endsWith('/projects/') && !r.url.includes('stats')).flush(
      page0([project]),
    );
    httpMock.expectOne((r) => r.url.endsWith('/organizations/')).flush(page0([]));
    httpMock.expectOne((r) => r.url.endsWith('/scientists/')).flush(page0([]));
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
    // The picker is the home's no-selection state — it must not show here.
    expect(fixture.nativeElement.querySelector('.project-card')).toBeNull();
  });

  it('shows the project picker (no dashboard) when no project is current', () => {
    const { fixture, projectService, httpMock } = setup();
    expect(projectService.currentProject()).toBeNull();

    fixture.detectChanges();

    httpMock.expectOne((r) => r.url.endsWith('/projects/')).flush(page0([makeProject()]));
    httpMock.expectOne((r) => r.url.endsWith('/organizations/')).flush(page0([]));
    httpMock.expectOne((r) => r.url.endsWith('/scientists/')).flush(page0([]));
    fixture.detectChanges();

    // No dashboard, and no stray stats request (online-only, only when a project is current).
    expect(fixture.nativeElement.querySelector('app-project-dashboard')).toBeNull();
    expect(fixture.nativeElement.querySelector('.project-card')).not.toBeNull();
    httpMock.verify();
  });

  it('lands on the home dashboard when a project is selected (ADR 0018)', () => {
    const { component, router, projectService } = setup();
    const navigate = spyOn(router, 'navigateByUrl').and.stub();
    const project = makeProject();

    component.selectProject(project);

    // ADR 0018: selecting a Projekt lands on the home dashboard (`/`), which now
    // renders that project's charts, not the capture list.
    expect(navigate).toHaveBeenCalledWith('/');
    expect(projectService.currentProject()?.id).toBe('p1');
  });
});
