import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { OverlayContainer } from '@angular/cdk/overlay';

import { NavBar } from './nav-bar';
import { ProjectService } from '../service/project.service';
import { AuthService } from '../service/auth.service';
import { Project } from '../models/project.model';
import { environment } from '../../environments/environment';

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

function signIn(ctx: ReturnType<typeof setup>, isStaff: boolean): void {
  TestBed.inject(AuthService).currentUser.set({
    username: 'fre',
    handle: 'FRE',
    isStaff,
  });
}

function openUserMenu(ctx: ReturnType<typeof setup>): HTMLElement[] {
  const trigger = ctx.fixture.nativeElement.querySelector('.user-trigger') as HTMLElement;
  trigger.click();
  ctx.fixture.detectChanges();
  return Array.from(
    ctx.overlay.getContainerElement().querySelectorAll('.mat-mdc-menu-item'),
  ) as HTMLElement[];
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

  it('shows a persistent "Beta" badge, even in the picker state with no active project', () => {
    const { fixture, projectService } = setup();
    expect(projectService.currentProject()).toBeNull();
    fixture.detectChanges();

    const badge = fixture.nativeElement.querySelector('.beta-badge') as HTMLElement;
    expect(badge).withContext('Beta badge').not.toBeNull();
    expect(badge.textContent).toContain('Beta');
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

  it('shows a "Neuer Fang" action linking to /data-entry in the workbench', () => {
    const ctx = setup();
    activate(ctx, makeProject());

    const action = ctx.fixture.nativeElement.querySelector('.new-fang') as HTMLAnchorElement;
    expect(action).withContext('Neuer Fang action').not.toBeNull();
    expect(action.getAttribute('href')).toBe('/data-entry');
    expect(action.textContent).toContain('Neuer Fang');
  });

  it('hides the "Neuer Fang" action while on the create form (exactly /data-entry)', async () => {
    TestBed.configureTestingModule({
      imports: [NavBar],
      providers: [
        provideRouter([
          { path: 'data-entry', children: [] },
          { path: 'data-entry/:id', children: [] },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
      ],
    });
    const fixture = TestBed.createComponent(NavBar);
    const projectService = TestBed.inject(ProjectService);
    const httpMock = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);

    projectService.setCurrent(makeProject());
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url.endsWith('/projects/')).flush(page0([makeProject()]));

    await router.navigateByUrl('/data-entry');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.new-fang'))
      .withContext('Neuer Fang hidden on the create form')
      .toBeNull();
  });

  it('keeps the "Neuer Fang" action on an edit route (/data-entry/:id)', async () => {
    TestBed.configureTestingModule({
      imports: [NavBar],
      providers: [
        provideRouter([
          { path: 'data-entry', children: [] },
          { path: 'data-entry/:id', children: [] },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
      ],
    });
    const fixture = TestBed.createComponent(NavBar);
    const projectService = TestBed.inject(ProjectService);
    const httpMock = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);

    projectService.setCurrent(makeProject());
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url.endsWith('/projects/')).flush(page0([makeProject()]));

    await router.navigateByUrl('/data-entry/42');
    fixture.detectChanges();

    const action = fixture.nativeElement.querySelector('.new-fang') as HTMLAnchorElement;
    expect(action).withContext('Neuer Fang visible on the edit route').not.toBeNull();
    expect(action.getAttribute('href')).toBe('/data-entry');
  });

  it('does not render the "Neuer Fang" action in the picker state', () => {
    const { fixture, projectService } = setup();
    expect(projectService.currentProject()).toBeNull();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.new-fang')).toBeNull();
  });

  it('renders "Letzte Fänge" in the right zone linking to /data-entries', () => {
    const ctx = setup();
    activate(ctx, makeProject());

    const el: HTMLElement = ctx.fixture.nativeElement;
    const link = el.querySelector('.letzte-faenge') as HTMLAnchorElement;
    expect(link).withContext('Letzte Fänge link').not.toBeNull();
    expect(link.getAttribute('href')).toBe('/data-entries');
    expect(link.textContent).toContain('Letzte Fänge');

    const spacer = el.querySelector('.spacer') as HTMLElement;
    expect(
      spacer.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).withContext('Letzte Fänge sits after the spacer (right zone)').toBeTruthy();
  });

  it('does not render "Letzte Fänge" in the picker state', () => {
    const { fixture, projectService } = setup();
    expect(projectService.currentProject()).toBeNull();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.letzte-faenge')).toBeNull();
  });

  it('highlights "Letzte Fänge" when on /data-entries via routerLinkActive', async () => {
    TestBed.configureTestingModule({
      imports: [NavBar],
      providers: [
        provideRouter([{ path: 'data-entries', children: [] }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
      ],
    });
    const fixture = TestBed.createComponent(NavBar);
    const projectService = TestBed.inject(ProjectService);
    const httpMock = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);

    projectService.setCurrent(makeProject());
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url.endsWith('/projects/')).flush(page0([makeProject()]));
    fixture.detectChanges();

    const link = fixture.nativeElement.querySelector('.letzte-faenge') as HTMLElement;
    expect(link.classList.contains('letzte-faenge--active'))
      .withContext('not active before navigation')
      .toBeFalse();

    await router.navigateByUrl('/data-entries');
    fixture.detectChanges();

    expect(link.classList.contains('letzte-faenge--active'))
      .withContext('active once on /data-entries')
      .toBeTrue();
  });

  it('does not render a top-level "Administration" button in the bar', () => {
    const ctx = setup();
    signIn(ctx, true);
    activate(ctx, makeProject());

    const bar: HTMLElement = ctx.fixture.nativeElement;
    expect(bar.textContent).not.toContain('Administration');
  });

  it('shows Administration in the user menu before Abmelden for staff, linking to admin', () => {
    const ctx = setup();
    signIn(ctx, true);
    activate(ctx, makeProject());

    const items = openUserMenu(ctx);
    const labels = items.map((i) => i.textContent ?? '');
    const adminIndex = labels.findIndex((t) => t.includes('Administration'));
    const logoutIndex = labels.findIndex((t) => t.includes('Abmelden'));

    expect(adminIndex).withContext('Administration present in user menu').toBeGreaterThan(-1);
    expect(logoutIndex).withContext('Abmelden present in user menu').toBeGreaterThan(-1);
    expect(adminIndex).withContext('Administration sits above Abmelden').toBeLessThan(logoutIndex);

    const adminItem = items[adminIndex] as HTMLAnchorElement;
    expect(adminItem.getAttribute('href')).toBe(environment.adminUrl);
  });

  it('never shows Administration for non-staff users', () => {
    const ctx = setup();
    signIn(ctx, false);
    activate(ctx, makeProject());

    expect(ctx.fixture.nativeElement.textContent).not.toContain('Administration');

    const labels = openUserMenu(ctx).map((i) => i.textContent ?? '');
    expect(labels.some((t) => t.includes('Administration')))
      .withContext('no Administration in the user menu for non-staff')
      .toBeFalse();
    expect(labels.some((t) => t.includes('Abmelden'))).toBeTrue();
  });
});
