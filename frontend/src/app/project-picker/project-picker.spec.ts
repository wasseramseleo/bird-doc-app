import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { ProjectPickerComponent } from './project-picker';
import { ProjectService } from '../service/project.service';
import { ProjectActionsService } from '../service/project-actions.service';
import { AuthService } from '../service/auth.service';
import { OrganizationRolle } from '../models/auth-user.model';
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

/**
 * Adopts the identity the picker branches on (issue #415): a null `handle` is
 * exactly "this account has no Beringer" — the same signal the Admin-side
 * "Mitglieder ohne Beringer-Eintrag" panel keys on — and `rolle` is the
 * per-Organisation Rolle, `null` when no Organisation is active.
 */
function signIn(handle: string | null, rolle: OrganizationRolle): void {
  TestBed.inject(AuthService).currentUser.set({
    username: 'fre',
    handle,
    isStaff: false,
    rolle,
    organization: null,
  });
}

/** Runs ngOnInit and settles the project-list + reference-data fetches. */
function render(ctx: ReturnType<typeof setup>, projects: Project[]): void {
  ctx.fixture.detectChanges();
  ctx.httpMock.expectOne((r) => r.url.endsWith('/projects/')).flush(page0(projects));
  ctx.httpMock.expectOne((r) => r.url.endsWith('/scientists/')).flush(page0([]));
  ctx.fixture.detectChanges();
}

/** The text of the empty state, as the affected account reads it. */
function emptyText(ctx: ReturnType<typeof setup>): string {
  const empty = ctx.fixture.nativeElement.querySelector('.picker__empty') as HTMLElement | null;
  return empty?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

/** The page-level "Neues Projekt" create action, or null when it is not rendered. */
function createButton(ctx: ReturnType<typeof setup>): HTMLButtonElement | null {
  const buttons = Array.from(
    ctx.fixture.nativeElement.querySelectorAll('button'),
  ) as HTMLButtonElement[];
  return buttons.find((b) => (b.textContent ?? '').includes('Neues Projekt')) ?? null;
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
    signIn('FRE', 'admin');
    render(ctx, [makeProject({ id: 'p1' })]);
    const create = spyOn(ctx.actions, 'create');

    const neu = createButton(ctx);
    expect(neu).withContext('"Neues Projekt" action present').toBeTruthy();
    neu!.click();

    expect(create).toHaveBeenCalled();
  });

  // --- Empty state: it branches on the two facts the server acts on (#415) ----
  // Projekt visibility is scoped to the account's Beringer, and Projekt creation
  // is Admin-only. The picker used to ignore both and told everyone the same
  // untrue thing: "Du bist noch keinem Projekt zugeordnet."

  describe('empty state', () => {
    it('names the missing Beringer as the cause for a no-Beringer Admin, not a missing Projekt-Zuordnung', () => {
      const ctx = setup();
      signIn(null, 'admin');
      render(ctx, []);

      expect(emptyText(ctx)).toContain('Beringer');
      expect(emptyText(ctx))
        .withContext('the wrong diagnosis must not survive for an account with no Beringer')
        .not.toContain('Du bist noch keinem Projekt zugeordnet');
    });

    it('points a no-Beringer Admin at "Beringer verwalten" as their own remedy', () => {
      const ctx = setup();
      signIn(null, 'admin');
      render(ctx, []);

      const remedy = ctx.fixture.nativeElement.querySelector(
        '.picker__empty a[href="/beringer"]',
      ) as HTMLAnchorElement | null;

      expect(remedy).withContext('link to the Beringer verwalten surface').toBeTruthy();
      expect(remedy!.textContent).toContain('Beringer verwalten');
    });

    it('names the missing Beringer for a no-Beringer Mitglied and tells them an Admin must assign one', () => {
      const ctx = setup();
      signIn(null, 'mitglied');
      render(ctx, []);

      expect(emptyText(ctx)).toContain('Beringer');
      expect(emptyText(ctx)).toContain('Administrator');
      expect(emptyText(ctx)).not.toContain('Du bist noch keinem Projekt zugeordnet');
      // Beringer verwalten is Admin-only — pointing a Mitglied there is a dead end.
      expect(ctx.fixture.nativeElement.querySelector('.picker__empty a[href="/beringer"]'))
        .withContext('a Mitglied cannot reach Beringer verwalten')
        .toBeNull();
    });

    it('tells a Mitglied with a Beringer that an Admin adds them to a Projekt, never to create one', () => {
      const ctx = setup();
      signIn('FRE', 'mitglied');
      render(ctx, []);

      expect(emptyText(ctx)).toContain('Du bist noch keinem Projekt zugeordnet');
      expect(emptyText(ctx)).toContain('Administrator');
      expect(emptyText(ctx))
        .withContext('the server refuses a Mitglied\'s create (403) — do not advise it')
        .not.toContain('Lege ein neues Projekt an');
    });

    it('keeps the status-quo create-a-Projekt message for an Admin with a Beringer', () => {
      const ctx = setup();
      signIn('FRE', 'admin');
      render(ctx, []);

      expect(emptyText(ctx)).toContain(
        'Du bist noch keinem Projekt zugeordnet. Lege ein neues Projekt an, um mit der Dateneingabe zu beginnen.',
      );
    });
  });

  // --- "Neues Projekt" visibility, in every picker state (#415) ---------------
  // The button used to render unconditionally, offering a create the server
  // would refuse (Mitglied → 403) or, worse, honour into invisibility (Admin
  // with no Beringer → 201, then count: 0).

  describe('"Neues Projekt" visibility', () => {
    it('renders for an Admin with a Beringer', () => {
      const ctx = setup();
      signIn('FRE', 'admin');
      render(ctx, []);

      expect(createButton(ctx)).withContext('an Admin with a Beringer can create').toBeTruthy();
    });

    it('is not rendered for an Admin with no Beringer, whose Projekt would be invisible to them', () => {
      const ctx = setup();
      signIn(null, 'admin');
      render(ctx, []);

      expect(createButton(ctx)).toBeNull();
    });

    it('is not rendered for a Mitglied with a Beringer', () => {
      const ctx = setup();
      signIn('FRE', 'mitglied');
      render(ctx, []);

      expect(createButton(ctx)).toBeNull();
    });

    it('is not rendered for a Mitglied with no Beringer', () => {
      const ctx = setup();
      signIn(null, 'mitglied');
      render(ctx, []);

      expect(createButton(ctx)).toBeNull();
    });

    it('is not rendered for an unresolved Rolle (no active Organisation)', () => {
      const ctx = setup();
      signIn('FRE', null);
      render(ctx, []);

      expect(createButton(ctx)).toBeNull();
    });

    it('is not rendered for a Mitglied in the non-empty state either', () => {
      const ctx = setup();
      signIn('FRE', 'mitglied');
      render(ctx, [makeProject({ id: 'p1' }), makeProject({ id: 'p2' })]);

      expect(ctx.fixture.nativeElement.querySelectorAll('.project-card').length)
        .withContext('the list still renders for a Mitglied')
        .toBe(2);
      expect(createButton(ctx))
        .withContext('gating is not an empty-state-only concern')
        .toBeNull();
    });
  });
});
