import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { ProjectPickerComponent } from './project-picker';
import { ProjectService } from '../service/project.service';
import { ProjectActionsService } from '../service/project-actions.service';
import { Project, Projekttyp } from '../models/project.model';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    title: 'Schilfgürtel Linz',
    description: '',
    show_optional_fields: false,
    show_net_fields: true,
    projekttyp: Projekttyp.Sonstiges,
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
    imports: [ProjectPickerComponent],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      provideNoopAnimations(),
    ],
  });
  const fixture: ComponentFixture<ProjectPickerComponent> =
    TestBed.createComponent(ProjectPickerComponent);
  const projectService = TestBed.inject(ProjectService);
  const actions = TestBed.inject(ProjectActionsService);
  const router = TestBed.inject(Router);
  const httpMock = TestBed.inject(HttpTestingController);
  return { fixture, projectService, actions, router, httpMock };
}

/** Runs ngOnInit and settles the project-list + reference-data fetches. */
function render(ctx: ReturnType<typeof setup>, projects: Project[]): void {
  ctx.fixture.detectChanges();
  ctx.httpMock.expectOne((r) => r.url.endsWith('/projects/')).flush(page0(projects));
  ctx.httpMock.expectOne((r) => r.url.endsWith('/scientists/')).flush(page0([]));
  ctx.fixture.detectChanges();
}

describe('ProjectPickerComponent', () => {
  // selectProject persists to localStorage via the real ProjectService; clear it
  // so a chosen Projekt cannot rehydrate into a later spec.
  afterEach(() => localStorage.clear());

  it('renders a card per Projekt from the shared ProjectService list', () => {
    const ctx = setup();
    render(ctx, [
      makeProject({ id: 'p1', title: 'Schilfgürtel Linz' }),
      makeProject({ id: 'p2', title: 'Donau-Auen' }),
    ]);

    const titles = Array.from(
      ctx.fixture.nativeElement.querySelectorAll('.project-card__title'),
    ).map((el) => (el as HTMLElement).textContent?.trim());
    expect(titles).toEqual(['Schilfgürtel Linz', 'Donau-Auen']);
  });

  it('selects a Projekt (setCurrent) and navigates to the dashboard at /', () => {
    const ctx = setup();
    render(ctx, [makeProject({ id: 'p1', title: 'Schilfgürtel Linz' })]);
    const setCurrent = spyOn(ctx.projectService, 'setCurrent').and.callThrough();
    const navigate = spyOn(ctx.router, 'navigateByUrl').and.stub();

    (ctx.fixture.nativeElement.querySelector('.project-card__main') as HTMLButtonElement).click();

    expect(setCurrent).toHaveBeenCalled();
    expect(setCurrent.calls.mostRecent().args[0].id).toBe('p1');
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('wires the per-row IWM-Export and Bearbeiten buttons to the actions service', () => {
    const ctx = setup();
    render(ctx, [makeProject({ id: 'p1' })]);
    const exportIwm = spyOn(ctx.actions, 'exportIwm');
    const edit = spyOn(ctx.actions, 'edit');

    (
      ctx.fixture.nativeElement.querySelector(
        '[aria-label="Als IWM Excel exportieren"]',
      ) as HTMLButtonElement
    ).click();
    (
      ctx.fixture.nativeElement.querySelector('[aria-label="Projekt bearbeiten"]') as HTMLButtonElement
    ).click();

    expect(exportIwm).toHaveBeenCalled();
    expect(exportIwm.calls.mostRecent().args[0].id).toBe('p1');
    expect(edit).toHaveBeenCalled();
    expect(edit.calls.mostRecent().args[0].id).toBe('p1');
  });

  it('stops propagation on the per-row edit and export controls so they do not select the Projekt', () => {
    const ctx = setup();
    render(ctx, [makeProject({ id: 'p1' })]);
    spyOn(ctx.actions, 'edit');
    spyOn(ctx.actions, 'exportIwm');
    const project = makeProject({ id: 'p1' });

    const editEvent = new MouseEvent('click');
    const editStop = spyOn(editEvent, 'stopPropagation');
    ctx.fixture.componentInstance.edit(project, editEvent);
    expect(editStop).toHaveBeenCalled();

    const exportEvent = new MouseEvent('click');
    const exportStop = spyOn(exportEvent, 'stopPropagation');
    ctx.fixture.componentInstance.exportIwm(project, exportEvent);
    expect(exportStop).toHaveBeenCalled();
  });

  it('triggers create via the "Neues Projekt" action', () => {
    const ctx = setup();
    render(ctx, [makeProject({ id: 'p1' })]);
    const create = spyOn(ctx.actions, 'create');

    const neu = (Array.from(ctx.fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (b) => (b.textContent ?? '').includes('Neues Projekt'),
    );
    expect(neu).withContext('"Neues Projekt" action present').toBeTruthy();
    neu!.click();

    expect(create).toHaveBeenCalled();
  });
});
