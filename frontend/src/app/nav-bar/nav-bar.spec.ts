import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { OverlayContainer } from '@angular/cdk/overlay';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { firstValueFrom, of } from 'rxjs';

import { NavBar } from './nav-bar';
import { ProjectService } from '../service/project.service';
import { AuthService } from '../service/auth.service';
import { OutboxService } from '../service/outbox.service';
import { IndexedDbStore } from '../core/offline/indexed-db-store';
import { Project } from '../models/project.model';
import { environment } from '../../environments/environment';
import { FeedbackDialogComponent } from '../feedback/feedback-dialog/feedback-dialog';

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

function signIn(
  ctx: ReturnType<typeof setup>,
  isStaff: boolean,
  rolle: 'admin' | 'mitglied' | null = null,
): void {
  TestBed.inject(AuthService).currentUser.set({
    username: 'fre',
    handle: 'FRE',
    isStaff,
    rolle,
    organization: null,
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

const QUEUED_ID = 'nav-logout-guard-1';

/**
 * Signs `fre` in and durably queues one outbox entry for that account, so
 * `OutboxService.pendingCount()` reads 1 — the non-empty-outbox precondition
 * for the logout guard (issue #165).
 */
async function queueOneCapture(ctx: ReturnType<typeof setup>): Promise<OutboxService> {
  signIn(ctx, false);
  const outbox = TestBed.inject(OutboxService);
  await outbox.ready;
  await firstValueFrom(outbox.enqueue({idempotency_key: QUEUED_ID, species_id: 's1'}));
  return outbox;
}

describe('NavBar', () => {
  afterEach(async () => {
    TestBed.inject(OverlayContainer).ngOnDestroy();
    localStorage.clear();
    // The single 'outbox' IndexedDB store survives across tests in the browser;
    // drop the row any logout-guard test queued so counts don't leak forward.
    await TestBed.inject(IndexedDbStore).delete('outbox', QUEUED_ID);
  });

  it('warns loudly before logging out with a non-empty outbox and aborts when declined', async () => {
    const ctx = setup();
    const outbox = await queueOneCapture(ctx);
    expect(outbox.pendingCount()).toBe(1);

    const auth = TestBed.inject(AuthService);
    const logout = spyOn(auth, 'logout').and.returnValue(of(undefined));
    const navigate = spyOn(ctx.router, 'navigate').and.stub();
    const confirm = spyOn(window, 'confirm').and.returnValue(false);

    ctx.fixture.componentInstance.onLogout();

    expect(confirm).withContext('a loud confirm is shown').toHaveBeenCalled();
    const message = confirm.calls.mostRecent().args[0] as string;
    expect(message).withContext('warns it is not synced').toContain('nicht synchronisiert');
    expect(message).withContext('states the count').toContain('1');
    // Declined: the session stays; nothing is logged out or navigated away.
    expect(logout).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(outbox.pendingCount()).toBe(1);
  });

  it('proceeds with logout when the non-empty-outbox warning is confirmed', async () => {
    const ctx = setup();
    await queueOneCapture(ctx);

    const auth = TestBed.inject(AuthService);
    const logout = spyOn(auth, 'logout').and.returnValue(of(undefined));
    const navigate = spyOn(ctx.router, 'navigate').and.stub();
    spyOn(window, 'confirm').and.returnValue(true);

    ctx.fixture.componentInstance.onLogout();

    expect(logout).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/login']);
  });

  it('logs out without any warning when the outbox is empty', () => {
    const ctx = setup();
    signIn(ctx, false);
    expect(TestBed.inject(OutboxService).pendingCount()).toBe(0);

    const auth = TestBed.inject(AuthService);
    const logout = spyOn(auth, 'logout').and.returnValue(of(undefined));
    const navigate = spyOn(ctx.router, 'navigate').and.stub();
    const confirm = spyOn(window, 'confirm').and.returnValue(true);

    ctx.fixture.componentInstance.onLogout();

    expect(confirm).withContext('no warning when nothing is queued').not.toHaveBeenCalled();
    expect(logout).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/login']);
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

  it('switches to another project via setCurrent and lands on the home dashboard (ADR 0018)', () => {
    const ctx = setup();
    const active = makeProject({ id: 'p1', title: 'Schilfgürtel Linz' });
    const other = makeProject({ id: 'p2', title: 'Donau-Auen' });
    activate(ctx, active, [active, other]);

    const setCurrent = spyOn(ctx.projectService, 'setCurrent').and.callThrough();
    const navigate = spyOn(ctx.router, 'navigateByUrl').and.stub();

    const items = openSwitcher(ctx);
    const otherItem = items.find((i) => (i.textContent ?? '').includes('Donau-Auen'))!;
    otherItem.click();

    // ADR 0018: switching a Projekt lands on the home dashboard (`/`), which
    // re-renders for the newly-active project, not the capture list.
    expect(setCurrent).toHaveBeenCalledWith(other);
    expect(navigate).toHaveBeenCalledWith('/');
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

  it('offers a persistent "Fehler melden" button even in the picker state', () => {
    const { fixture, projectService } = setup();
    expect(projectService.currentProject()).toBeNull();
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('.feedback-button') as HTMLElement;
    expect(button).withContext('persistent Fehler melden button').not.toBeNull();
    expect(button.textContent).toContain('Fehler melden');
  });

  it('opens the feedback dialog when the "Fehler melden" button is clicked', () => {
    const ctx = setup();
    signIn(ctx, false);
    ctx.fixture.detectChanges();

    const dialog = ctx.fixture.debugElement.injector.get(MatDialog);
    const open = spyOn(dialog, 'open').and.returnValue({
      afterClosed: () => of(false),
    } as MatDialogRef<unknown>);

    const button = ctx.fixture.nativeElement.querySelector('.feedback-button') as HTMLButtonElement;
    button.click();
    ctx.fixture.detectChanges();

    expect(open).toHaveBeenCalledWith(FeedbackDialogComponent, jasmine.any(Object));
  });

  it('shows "Stationen verwalten" in the user menu for an org admin, linking to /stationen', () => {
    const ctx = setup();
    signIn(ctx, false, 'admin');
    activate(ctx, makeProject());

    const items = openUserMenu(ctx);
    const stationItem = items.find((i) => (i.textContent ?? '').includes('Stationen verwalten')) as
      | HTMLAnchorElement
      | undefined;

    expect(stationItem).withContext('Stationen verwalten present for admin').toBeTruthy();
    expect(stationItem!.getAttribute('href')).toBe('/stationen');
  });

  it('never shows "Stationen verwalten" for a plain Mitglied', () => {
    const ctx = setup();
    signIn(ctx, false, 'mitglied');
    activate(ctx, makeProject());

    const labels = openUserMenu(ctx).map((i) => i.textContent ?? '');
    expect(labels.some((t) => t.includes('Stationen verwalten')))
      .withContext('no Stationen verwalten for Mitglied')
      .toBeFalse();
  });

  it('never shows "Stationen verwalten" when there is no active-organization Rolle', () => {
    const ctx = setup();
    signIn(ctx, true, null);
    activate(ctx, makeProject());

    const labels = openUserMenu(ctx).map((i) => i.textContent ?? '');
    expect(labels.some((t) => t.includes('Stationen verwalten')))
      .withContext('no Stationen verwalten without an admin Rolle')
      .toBeFalse();
  });

  it('shows "Beringer verwalten" in the user menu for an org admin, linking to /beringer', () => {
    const ctx = setup();
    signIn(ctx, false, 'admin');
    activate(ctx, makeProject());

    const items = openUserMenu(ctx);
    const beringerItem = items.find((i) => (i.textContent ?? '').includes('Beringer verwalten')) as
      | HTMLAnchorElement
      | undefined;

    expect(beringerItem).withContext('Beringer verwalten present for admin').toBeTruthy();
    expect(beringerItem!.getAttribute('href')).toBe('/beringer');
  });

  it('never shows "Beringer verwalten" for a plain Mitglied', () => {
    const ctx = setup();
    signIn(ctx, false, 'mitglied');
    activate(ctx, makeProject());

    const labels = openUserMenu(ctx).map((i) => i.textContent ?? '');
    expect(labels.some((t) => t.includes('Beringer verwalten')))
      .withContext('no Beringer verwalten for Mitglied')
      .toBeFalse();
  });

  it('collapses "Heutige Session" into the user dropdown (linking to /heute), not the toolbar', () => {
    const ctx = setup();
    signIn(ctx, false);
    activate(ctx, makeProject());

    // No longer a standalone toolbar button.
    expect(ctx.fixture.nativeElement.querySelector('.heutige-session'))
      .withContext('Heutige Session removed from the toolbar')
      .toBeNull();

    const items = openUserMenu(ctx);
    const heute = items.find((i) => (i.textContent ?? '').includes('Heutige Session')) as
      | HTMLAnchorElement
      | undefined;
    expect(heute).withContext('Heutige Session present in the user dropdown').toBeTruthy();
    expect(heute!.getAttribute('href')).toBe('/heute');
  });

  it('does not offer "Heutige Session" in the picker state (no active project)', () => {
    const ctx = setup();
    signIn(ctx, false);
    ctx.fixture.detectChanges();

    const labels = openUserMenu(ctx).map((i) => i.textContent ?? '');
    expect(labels.some((t) => t.includes('Heutige Session')))
      .withContext('no Heutige Session without an active project')
      .toBeFalse();
  });

  it('collapses the outbox and offline-readiness chips into the user dropdown, off the toolbar', () => {
    const ctx = setup();
    signIn(ctx, false);
    activate(ctx, makeProject());

    // The chips are no longer standalone toolbar elements.
    const bar: HTMLElement = ctx.fixture.nativeElement;
    expect(bar.querySelector('app-outbox-indicator'))
      .withContext('outbox chip off the toolbar')
      .toBeNull();
    expect(bar.querySelector('app-offline-readiness'))
      .withContext('offline-readiness chip off the toolbar')
      .toBeNull();
    // The transient offline banner stays on the toolbar (not part of the move).
    expect(bar.querySelector('app-offline-indicator'))
      .withContext('offline-indicator stays on the toolbar')
      .not.toBeNull();

    openUserMenu(ctx);
    const overlay = ctx.overlay.getContainerElement();
    expect(overlay.querySelector('.user-menu__status app-outbox-indicator'))
      .withContext('outbox chip inside the dropdown')
      .not.toBeNull();
    expect(overlay.querySelector('.user-menu__status app-offline-readiness'))
      .withContext('offline-readiness chip inside the dropdown')
      .not.toBeNull();
  });

  it('keeps the offline-readiness auto-refresh eager even though it now lives in the closed menu', () => {
    // Regression guard for the collapse: a <mat-menu>'s direct content is
    // instantiated eagerly, so OfflineReadiness still fires its reference-cache
    // refresh on init — the cache must not go stale until the user opens the menu.
    const ctx = setup();
    signIn(ctx, false);
    ctx.fixture.detectChanges();

    const req = ctx.httpMock.expectOne((r) => r.url.endsWith('/offline-bundle/'));
    expect(req.request.method).withContext('eager reference-cache refresh on init').toBe('GET');
    // Fail it offline-style so nothing is written to the shared IndexedDB cache.
    req.error(new ProgressEvent('error'));
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
