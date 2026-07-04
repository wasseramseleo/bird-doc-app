import {ComponentFixture, TestBed} from '@angular/core/testing';
import {MatDialogRef, MAT_DIALOG_DATA} from '@angular/material/dialog';
import {provideNoopAnimations} from '@angular/platform-browser/animations';
import {of} from 'rxjs';

import {
  ProjectEditDialogComponent,
  ProjectEditDialogData,
  ProjectEditDialogResult,
} from './project-edit-dialog';
import {ApiService} from '../../service/api.service';
import {Project, Projekttyp} from '../../models/project.model';
import {Organization} from '../../models/organization.model';
import {Scientist} from '../../models/scientist.model';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    title: 'Schilfgürtel Linz',
    description: '',
    show_optional_fields: false,
    projekttyp: Projekttyp.Sonstiges,
    organization: {handle: 'ORG1', name: 'IWM Linz'} as Organization,
    default_station: null,
    // At least one Beringer so the edit form (scientistIds is required) is valid
    // and submit() actually closes.
    scientists: [{id: 's1', handle: 'a.huber', full_name: 'Anna Huber'} as Scientist],
    created: '2026-06-01T00:00:00Z',
    updated: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

function setup(project: Project) {
  const data: ProjectEditDialogData = {project, scientists: []};
  const dialogRef = jasmine.createSpyObj<
    MatDialogRef<ProjectEditDialogComponent, ProjectEditDialogResult>
  >('MatDialogRef', ['close']);
  const api = {
    getRingingStations: jasmine.createSpy('getRingingStations').and.returnValue(of({results: []})),
  };
  TestBed.configureTestingModule({
    imports: [ProjectEditDialogComponent],
    providers: [
      provideNoopAnimations(),
      {provide: MatDialogRef, useValue: dialogRef},
      {provide: MAT_DIALOG_DATA, useValue: data},
      {provide: ApiService, useValue: api},
    ],
  });
  const fixture: ComponentFixture<ProjectEditDialogComponent> =
    TestBed.createComponent(ProjectEditDialogComponent);
  fixture.detectChanges();
  return {fixture, component: fixture.componentInstance, dialogRef};
}

describe('ProjectEditDialogComponent', () => {
  it('pre-fills the Projekttyp select from the Projekt', () => {
    const {fixture, component} = setup(makeProject({projekttyp: Projekttyp.Nestlingsberingung}));

    expect(component.form.controls.projekttyp.value).toBe(Projekttyp.Nestlingsberingung);
    expect(fixture.nativeElement.textContent).toContain('Projekttyp');
  });

  it('round-trips the edited Projekttyp into the dialog result', () => {
    const {component, dialogRef} = setup(makeProject());

    component.form.controls.projekttyp.setValue(Projekttyp.Zugvogelmonitoring);
    component.submit();

    expect(dialogRef.close).toHaveBeenCalledWith(
      jasmine.objectContaining({projekttyp: Projekttyp.Zugvogelmonitoring}),
    );
  });
});
