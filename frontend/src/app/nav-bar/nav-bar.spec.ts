import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { OverlayContainer } from '@angular/cdk/overlay';

import { NavBar } from './nav-bar';
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

function page0<T>(results: T[]) {
  return { count: results.length, next: null, previous: null, results };
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
  const router = TestBed.inject(Router);
  const httpMock = TestBed.inject(HttpTestingController);
  const overlay = TestBed.inject(OverlayContainer);
  return { fixture, projectService, router, httpMock, overlay };
}

/**
 * Activates a project (workbench state) and resolves the project-list fetch the
 * switcher kicks off, so the menu has projects to show.
 */
function activate(
  ctx: ReturnType<typeof setup>,
  current: Project,
  list: Project[] = [current],
): void {
  ctx.projectService.setCurrent(current);
  ctx.fixture.detectChanges();
  ctx.httpMock.expectOne((r) => r.url.endsWith('/projects/')).flush(page0(list));
  ctx.fixture.detectChanges();
}

function openSwitcher(ctx: ReturnType<typeof setup>): HTMLElement[] {
  const trigger = ctx.fixture.nativeElement.querySelector('.project-switcher') as HTMLElement;
  trigger.click();
  ctx.fixture.detectChanges();
  return Array.from(
    ctx.overlay.getContainerElement().querySelectorAll('.mat-mdc-menu-item'),
  ) as HTMLElement[];
}

describe('NavBar', () => {
  afterEach(() => {
    TestBed.inject(OverlayContainer).ngOnDestroy();
    localStorage.clear();
  });

  it('should create', () => {
    const { fixture } = setup();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('shows the switcher trigger with the active project title', () => {
    const ctx = setup();
    activate(ctx, makeProject());

    const trigger = ctx.fixture.nativeElement.querySelector('.project-switcher') as HTMLElement;
    expect(trigger).withContext('switcher trigger').not.toBeNull();
    expect(trigger.textContent).toContain('Schilfgürtel Linz');
  });

  it('does not render the switcher when no project is active (picker state)', () => {
    const { fixture, projectService } = setup();
    expect(projectService.currentProject()).toBeNull();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.project-switcher')).toBeNull();
    expect(el.querySelector('.project-context')).toBeNull();
  });

  it('lists the user projects in the switcher with the active one marked', () => {
    const ctx = setup();
    const active = makeProject({ id: 'p1', title: 'Schilfgürtel Linz' });
    const other = makeProject({ id: 'p2', title: 'Donau-Auen' });
    activate(ctx, active, [active, other]);

    const items = openSwitcher(ctx);
    const labels = items.map((i) => i.textContent ?? '');
    expect(labels.some((t) => t.includes('Schilfgürtel Linz'))).toBeTrue();
    expect(labels.some((t) => t.includes('Donau-Auen'))).toBeTrue();
    expect(labels.some((t) => t.includes('Alle Projekte'))).toBeTrue();

    const activeItem = items.find((i) =>
      i.classList.contains('project-switcher__item--active'),
    );
    expect(activeItem?.textContent).toContain('Schilfgürtel Linz');
  });

  it('switches to another project via setCurrent and routes to the hub', () => {
    const ctx = setup();
    const active = makeProject({ id: 'p1', title: 'Schilfgürtel Linz' });
    const other = makeProject({ id: 'p2', title: 'Donau-Auen' });
    activate(ctx, active, [active, other]);

    const setCurrent = spyOn(ctx.projectService, 'setCurrent').and.callThrough();
    const navigate = spyOn(ctx.router, 'navigateByUrl').and.stub();

    const items = openSwitcher(ctx);
    const otherItem = items.find((i) => (i.textContent ?? '').includes('Donau-Auen'))!;
    otherItem.click();

    expect(setCurrent).toHaveBeenCalledWith(other);
    expect(navigate).toHaveBeenCalledWith('/data-entries');
  });

  it('returns to the picker from the "Alle Projekte …" item', () => {
    const ctx = setup();
    activate(ctx, makeProject());
    const navigate = spyOn(ctx.router, 'navigateByUrl').and.stub();

    const items = openSwitcher(ctx);
    const allItem = items.find((i) => (i.textContent ?? '').includes('Alle Projekte'))!;
    allItem.click();

    expect(navigate).toHaveBeenCalledWith('/');
  });
});
