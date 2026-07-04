import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';

import { ProjectActionsService } from './project-actions.service';
import { ProjectService } from './project.service';
import { Project, Projekttyp } from '../models/project.model';
import { Organization } from '../models/organization.model';
import { ProjectEditDialogComponent, ProjectEditDialogResult } from '../home/project-edit-dialog/project-edit-dialog';
import { ProjectCreateDialogComponent, ProjectCreateDialogResult } from '../home/project-create-dialog/project-create-dialog';

function makeOrg(): Organization {
  return { id: 'o1', name: 'IWM Linz', handle: 'iwm' } as Organization;
}

function createResult(overrides: Partial<ProjectCreateDialogResult> = {}): ProjectCreateDialogResult {
  return {
    title: 'Neues Projekt',
    description: 'Beschreibung',
    organizationHandle: 'iwm',
    projekttyp: Projekttyp.Sonstiges,
    defaultStationHandle: '',
    ...overrides,
  };
}

function editResult(overrides: Partial<ProjectEditDialogResult> = {}): ProjectEditDialogResult {
  return {
    title: 'Neuer Titel',
    description: 'Beschreibung',
    scientistIds: ['s1'],
    showOptionalFields: false,
    projekttyp: Projekttyp.Sonstiges,
    defaultStationHandle: '',
    ...overrides,
  };
}

function stubDialog<T>(dialog: MatDialog, result: T): void {
  spyOn(dialog, 'open').and.returnValue({
    afterClosed: () => of(result),
  } as MatDialogRef<unknown>);
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    title: 'Schilfgürtel Linz',
    description: '',
    show_optional_fields: false,
    projekttyp: Projekttyp.Sonstiges,
    organization: { id: 'o1', name: 'IWM Linz', handle: 'iwm' } as Project['organization'],
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
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      provideNoopAnimations(),
    ],
  });
  const service = TestBed.inject(ProjectActionsService);
  const httpMock = TestBed.inject(HttpTestingController);
  const projectService = TestBed.inject(ProjectService);
  const snackBar = TestBed.inject(MatSnackBar);
  const dialog = TestBed.inject(MatDialog);
  const router = TestBed.inject(Router);
  return { service, httpMock, projectService, snackBar, dialog, router };
}

/** Captures every <a> the service builds for a download and stubs its click(). */
function captureAnchors(): HTMLAnchorElement[] {
  const anchors: HTMLAnchorElement[] = [];
  const realCreate = document.createElement.bind(document);
  spyOn(document, 'createElement').and.callFake((tag: string, options?: ElementCreationOptions) => {
    const el = realCreate(tag as 'a', options);
    if (tag === 'a') {
      spyOn(el as HTMLAnchorElement, 'click');
      anchors.push(el as HTMLAnchorElement);
    }
    return el;
  });
  return anchors;
}

describe('ProjectActionsService', () => {
  afterEach(() => localStorage.clear());

  describe('exportIwm', () => {
    it('downloads the IWM Excel, naming the file from Content-Disposition', () => {
      const { service, httpMock } = setup();
      const anchors = captureAnchors();

      service.exportIwm(makeProject({ id: 'p7', title: 'Schilfgürtel Linz' }));

      const req = httpMock.expectOne((r) => r.url.endsWith('/projects/p7/export-iwm/'));
      expect(req.request.method).toBe('GET');
      req.flush(new Blob(['xlsx-bytes']), {
        headers: { 'Content-Disposition': 'attachment; filename="IWM_Linz.xlsx"' },
      });

      expect(anchors.length).withContext('one download anchor built').toBe(1);
      expect(anchors[0].download).toBe('IWM_Linz.xlsx');
      expect(anchors[0].click).toHaveBeenCalled();
    });

    it('falls back to an IWM_<title>.xlsx filename when no Content-Disposition is present', () => {
      const { service, httpMock } = setup();
      const anchors = captureAnchors();

      service.exportIwm(makeProject({ id: 'p7', title: 'Donau-Auen' }));

      httpMock.expectOne((r) => r.url.endsWith('/projects/p7/export-iwm/')).flush(new Blob(['x']));

      expect(anchors[0].download).toBe('IWM_Donau-Auen.xlsx');
    });

    it('shows a German error snackbar when the IWM export fails', () => {
      const { service, httpMock, snackBar } = setup();
      const open = spyOn(snackBar, 'open');

      service.exportIwm(makeProject({ id: 'p7' }));
      httpMock
        .expectOne((r) => r.url.endsWith('/projects/p7/export-iwm/'))
        .error(new ProgressEvent('error'));

      expect(open).toHaveBeenCalled();
      expect(open.calls.mostRecent().args[0] as string).toContain('IWM-Export fehlgeschlagen');
    });
  });

  describe('edit', () => {
    it('opens the edit dialog, PATCHes the mapped payload, snackbars, and upserts', () => {
      const { service, httpMock, projectService, snackBar, dialog } = setup();
      const upsert = spyOn(projectService, 'upsertProject').and.callThrough();
      const snack = spyOn(snackBar, 'open');
      stubDialog(
        dialog,
        editResult({
          title: 'Neuer Titel',
          description: 'desc',
          scientistIds: ['s1', 's2'],
          showOptionalFields: true,
          projekttyp: Projekttyp.IWM,
          defaultStationHandle: 'st1',
        }),
      );

      const project = makeProject({ id: 'p3', title: 'Alt' });
      service.edit(project);

      expect((dialog.open as jasmine.Spy).calls.mostRecent().args[0]).toBe(ProjectEditDialogComponent);
      const req = httpMock.expectOne((r) => r.url.endsWith('/projects/p3/'));
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({
        title: 'Neuer Titel',
        description: 'desc',
        scientist_ids: ['s1', 's2'],
        show_optional_fields: true,
        projekttyp: Projekttyp.IWM,
        default_station_id: 'st1',
      });

      const updated = makeProject({ id: 'p3', title: 'Neuer Titel' });
      req.flush(updated);

      expect(upsert).toHaveBeenCalledWith(updated);
      expect(snack.calls.mostRecent().args[0] as string).toContain('aktualisiert');
    });

    it('sends default_station_id: null when no default Station is chosen', () => {
      const { service, httpMock, dialog } = setup();
      stubDialog(dialog, editResult({ defaultStationHandle: '' }));

      service.edit(makeProject({ id: 'p3' }));

      const req = httpMock.expectOne((r) => r.url.endsWith('/projects/p3/'));
      expect(req.request.body.default_station_id).toBeNull();
      req.flush(makeProject({ id: 'p3' }));
    });

    it('re-sets the current Projekt when the edited one is currently active', () => {
      const { service, httpMock, projectService, dialog } = setup();
      const project = makeProject({ id: 'p3', title: 'Alt' });
      projectService.setCurrent(project);
      const setCurrent = spyOn(projectService, 'setCurrent').and.callThrough();
      stubDialog(dialog, editResult({ title: 'Neu' }));

      service.edit(project);
      const updated = makeProject({ id: 'p3', title: 'Neu' });
      httpMock.expectOne((r) => r.url.endsWith('/projects/p3/')).flush(updated);

      expect(setCurrent).toHaveBeenCalledWith(updated);
    });

    it('does NOT touch the current Projekt when a different one is edited', () => {
      const { service, httpMock, projectService, dialog } = setup();
      projectService.setCurrent(makeProject({ id: 'p-current' }));
      const setCurrent = spyOn(projectService, 'setCurrent').and.callThrough();
      stubDialog(dialog, editResult());

      service.edit(makeProject({ id: 'p3' }));
      httpMock.expectOne((r) => r.url.endsWith('/projects/p3/')).flush(makeProject({ id: 'p3' }));

      expect(setCurrent).not.toHaveBeenCalled();
    });

    it('shows a German error snackbar when the update fails', () => {
      const { service, httpMock, snackBar, dialog } = setup();
      const open = spyOn(snackBar, 'open');
      stubDialog(dialog, editResult());

      service.edit(makeProject({ id: 'p3' }));
      httpMock
        .expectOne((r) => r.url.endsWith('/projects/p3/'))
        .error(new ProgressEvent('error'));

      expect(open.calls.mostRecent().args[0] as string).toContain('nicht aktualisiert');
    });

    it('does nothing when the edit dialog is dismissed', () => {
      const { service, httpMock, dialog } = setup();
      stubDialog(dialog, undefined);

      service.edit(makeProject({ id: 'p3' }));

      httpMock.expectNone((r) => r.url.endsWith('/projects/p3/'));
    });
  });

  describe('create', () => {
    // The create dialog needs the Organisationen the new Projekt can belong to;
    // loadReferenceData() fetches them (and the scientists edit needs).
    function loadRefs(ctx: ReturnType<typeof setup>, orgs: Organization[] = [makeOrg()]): void {
      ctx.service.loadReferenceData();
      ctx.httpMock.expectOne((r) => r.url.endsWith('/organizations/')).flush(page0(orgs));
      ctx.httpMock.expectOne((r) => r.url.endsWith('/scientists/')).flush(page0([]));
    }

    it('opens the create dialog, POSTs, snackbars, upserts, and selects the new Projekt', () => {
      const ctx = setup();
      loadRefs(ctx);
      const upsert = spyOn(ctx.projectService, 'upsertProject').and.callThrough();
      const setCurrent = spyOn(ctx.projectService, 'setCurrent').and.callThrough();
      const navigate = spyOn(ctx.router, 'navigateByUrl').and.stub();
      const snack = spyOn(ctx.snackBar, 'open');
      stubDialog(ctx.dialog, createResult({ title: 'Neues Projekt', description: 'd', organizationHandle: 'iwm', projekttyp: Projekttyp.Nestlingsberingung }));

      ctx.service.create();

      expect((ctx.dialog.open as jasmine.Spy).calls.mostRecent().args[0]).toBe(ProjectCreateDialogComponent);
      const req = ctx.httpMock.expectOne((r) => r.url.endsWith('/projects/') && r.method === 'POST');
      expect(req.request.body).toEqual({
        title: 'Neues Projekt',
        description: 'd',
        organization_id: 'iwm',
        projekttyp: Projekttyp.Nestlingsberingung,
        default_station_id: null,
      });

      const created = makeProject({ id: 'p-new', title: 'Neues Projekt' });
      req.flush(created);

      expect(upsert).toHaveBeenCalledWith(created);
      // Creating a Projekt lands you on its dashboard (setCurrent + navigate to /).
      expect(setCurrent).toHaveBeenCalledWith(created);
      expect(navigate).toHaveBeenCalledWith('/');
      expect(snack.calls.mostRecent().args[0] as string).toContain('erstellt');
    });

    it('warns and opens no dialog when there is no Organisation to create under', () => {
      const ctx = setup();
      loadRefs(ctx, []);
      const open = spyOn(ctx.dialog, 'open');
      const snack = spyOn(ctx.snackBar, 'open');

      ctx.service.create();

      expect(open).not.toHaveBeenCalled();
      expect(snack.calls.mostRecent().args[0] as string).toContain('keine Organisation');
    });

    it('shows a German error snackbar when the create fails', () => {
      const ctx = setup();
      loadRefs(ctx);
      const snack = spyOn(ctx.snackBar, 'open');
      stubDialog(ctx.dialog, createResult());

      ctx.service.create();
      ctx.httpMock
        .expectOne((r) => r.url.endsWith('/projects/') && r.method === 'POST')
        .error(new ProgressEvent('error'));

      expect(snack.calls.mostRecent().args[0] as string).toContain('nicht erstellt');
    });

    it('does nothing when the create dialog is dismissed', () => {
      const ctx = setup();
      loadRefs(ctx);
      stubDialog(ctx.dialog, undefined);

      ctx.service.create();

      ctx.httpMock.expectNone((r) => r.url.endsWith('/projects/') && r.method === 'POST');
    });
  });
});
