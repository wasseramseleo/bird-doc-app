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
import {
  OPTIONAL_FIELD_LABELS,
  OPTIONAL_FIELD_ORDER,
  OptionalField,
  Project,
  Projekttyp,
} from '../../models/project.model';
import {Organization} from '../../models/organization.model';
import {Scientist} from '../../models/scientist.model';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    title: 'Schilfgürtel Linz',
    description: '',
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

  // --- Optionale Felder (ADR 0035, issue #430) -------------------------------
  // The Bearbeiten-Dialog shows the SAME control as the Anlegen-Dialog: one
  // „angehakt = sichtbar" checkbox per vocabulary entry.

  it('offers one checkbox per optional field, ticked = visible', () => {
    const {fixture, component} = setup(
      makeProject({hidden_optional_fields: [OptionalField.NetzBlock]}),
    );
    const boxes = component.form.controls.optionalFields;

    expect(Object.keys(boxes.controls)).toEqual([...OPTIONAL_FIELD_ORDER]);
    expect(boxes.controls[OptionalField.NetzBlock].value).toBe(false);
    expect(boxes.controls[OptionalField.Parasit].value).toBe(true);
    for (const label of Object.values(OPTIONAL_FIELD_LABELS)) {
      expect(fixture.nativeElement.textContent).toContain(label);
    }
  });

  it('ticks every box for a Projekt that hides nothing', () => {
    // US 33: an unconfigured Projekt shows all optional fields.
    const {component} = setup(makeProject({hidden_optional_fields: []}));

    expect(Object.values(component.form.controls.optionalFields.getRawValue())).toEqual(
      OPTIONAL_FIELD_ORDER.map(() => true),
    );
  });

  it('ticks every box for a Projekt whose payload predates the setting', () => {
    const {component} = setup(makeProject());

    expect(Object.values(component.form.controls.optionalFields.getRawValue())).toEqual(
      OPTIONAL_FIELD_ORDER.map(() => true),
    );
  });

  it('round-trips the un-ticked fields into the dialog result as the opt-out list', () => {
    const {component, dialogRef} = setup(
      makeProject({hidden_optional_fields: [OptionalField.Brutfleck]}),
    );

    // Brutfleck comes back on, Kerbe F2 goes off — the result names exactly what is
    // switched off after the edit, in vocabulary order.
    component.form.controls.optionalFields.controls[OptionalField.Brutfleck].setValue(true);
    component.form.controls.optionalFields.controls[OptionalField.KerbeF2].setValue(false);
    component.submit();

    expect(dialogRef.close).toHaveBeenCalledWith(
      jasmine.objectContaining({hiddenOptionalFields: [OptionalField.KerbeF2]}),
    );
  });

  // --- Saison window (ADR 0029, issue #373) ----------------------------------

  it('pre-fills the Saison month selects from the Projekt window', () => {
    const {fixture, component} = setup(
      makeProject({saison_start_month: 11, saison_end_month: 3}),
    );

    expect(component.form.controls.saisonStartMonth.value).toBe(11);
    expect(component.form.controls.saisonEndMonth.value).toBe(3);
    expect(fixture.nativeElement.textContent).toContain('Saison');
  });

  it('defaults the Saison selects to null (no season) when the Projekt has no window', () => {
    const {component} = setup(makeProject());

    expect(component.form.controls.saisonStartMonth.value).toBeNull();
    expect(component.form.controls.saisonEndMonth.value).toBeNull();
  });

  it('round-trips an edited Saison window into the dialog result', () => {
    const {component, dialogRef} = setup(makeProject());

    component.form.controls.saisonStartMonth.setValue(7);
    component.form.controls.saisonEndMonth.setValue(10);
    component.submit();

    expect(dialogRef.close).toHaveBeenCalledWith(
      jasmine.objectContaining({saisonStartMonth: 7, saisonEndMonth: 10}),
    );
  });

  it('carries a null Saison window into the dialog result when left unset', () => {
    const {component, dialogRef} = setup(makeProject());

    component.submit();

    expect(dialogRef.close).toHaveBeenCalledWith(
      jasmine.objectContaining({saisonStartMonth: null, saisonEndMonth: null}),
    );
  });
});
