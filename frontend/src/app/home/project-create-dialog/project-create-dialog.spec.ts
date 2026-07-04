import {ComponentFixture, TestBed} from '@angular/core/testing';
import {MatDialogRef, MAT_DIALOG_DATA} from '@angular/material/dialog';
import {provideNoopAnimations} from '@angular/platform-browser/animations';
import {of} from 'rxjs';

import {
  ProjectCreateDialogComponent,
  ProjectCreateDialogData,
  ProjectCreateDialogResult,
} from './project-create-dialog';
import {ApiService} from '../../service/api.service';
import {Organization} from '../../models/organization.model';
import {Projekttyp} from '../../models/project.model';

const ORG = {handle: 'ORG1', name: 'IWM Linz'} as Organization;

function setup(data: ProjectCreateDialogData = {organizations: [ORG]}) {
  const dialogRef = jasmine.createSpyObj<
    MatDialogRef<ProjectCreateDialogComponent, ProjectCreateDialogResult>
  >('MatDialogRef', ['close']);
  const api = {
    getRingingStations: jasmine.createSpy('getRingingStations').and.returnValue(of({results: []})),
  };
  TestBed.configureTestingModule({
    imports: [ProjectCreateDialogComponent],
    providers: [
      provideNoopAnimations(),
      {provide: MatDialogRef, useValue: dialogRef},
      {provide: MAT_DIALOG_DATA, useValue: data},
      {provide: ApiService, useValue: api},
    ],
  });
  const fixture: ComponentFixture<ProjectCreateDialogComponent> =
    TestBed.createComponent(ProjectCreateDialogComponent);
  fixture.detectChanges();
  return {fixture, component: fixture.componentInstance, dialogRef};
}

describe('ProjectCreateDialogComponent', () => {
  it('offers a Projekttyp mat-select defaulting to Sonstiges', () => {
    const {fixture, component} = setup();

    expect(component.form.controls.projekttyp).toBeDefined();
    expect(component.form.controls.projekttyp.value).toBe(Projekttyp.Sonstiges);
    expect(fixture.nativeElement.textContent).toContain('Projekttyp');
  });

  it('round-trips the chosen Projekttyp into the dialog result', () => {
    const {component, dialogRef} = setup();

    component.form.controls.title.setValue('Reedbed');
    component.form.controls.projekttyp.setValue(Projekttyp.IWM);
    component.submit();

    expect(dialogRef.close).toHaveBeenCalledWith(
      jasmine.objectContaining({title: 'Reedbed', projekttyp: Projekttyp.IWM}),
    );
  });
});
