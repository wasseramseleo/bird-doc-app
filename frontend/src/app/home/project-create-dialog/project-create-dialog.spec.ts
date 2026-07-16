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
import {Scientist} from '../../models/scientist.model';

const ORG = {handle: 'ORG1', name: 'IWM Linz'} as Organization;
// Alice is the creating Admin (her Kürzel is what /auth/me/ carries); Bob is a
// second Beringer of the same Organisation.
const ALICE = {id: 's-alice', handle: 'ALC', full_name: 'Alice Admin'} as Scientist;
const BOB = {id: 's-bob', handle: 'BOB', full_name: 'Bob Beringer'} as Scientist;

function makeData(overrides: Partial<ProjectCreateDialogData> = {}): ProjectCreateDialogData {
  return {
    organization: ORG,
    scientists: [ALICE, BOB],
    currentBeringerHandle: 'ALC',
    ...overrides,
  };
}

function setup(data: ProjectCreateDialogData = makeData()) {
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

  it('offers a Netzfelder checkbox defaulting to on', () => {
    const {fixture, component} = setup();

    expect(component.form.controls.showNetFields).toBeDefined();
    expect(component.form.controls.showNetFields.value).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Netzfelder');
  });

  it('round-trips the Netzfelder value into the dialog result', () => {
    const {component, dialogRef} = setup();

    component.form.controls.title.setValue('Nest boxes');
    component.form.controls.showNetFields.setValue(false);
    component.submit();

    expect(dialogRef.close).toHaveBeenCalledWith(
      jasmine.objectContaining({showNetFields: false}),
    );
  });

  it('seeds Netzfelder off when Nestlingsberingung is chosen (AC #1)', () => {
    const {component} = setup();

    component.form.controls.projekttyp.setValue(Projekttyp.Nestlingsberingung);

    expect(component.form.controls.showNetFields.value).toBe(false);
  });

  it('lets the Admin turn Netzfelder back on after the auto-off, and submits that choice (AC #2)', () => {
    const {component, dialogRef} = setup();

    // Picking Nestlingsberingung seeds the checkbox off as a convenience...
    component.form.controls.projekttyp.setValue(Projekttyp.Nestlingsberingung);
    expect(component.form.controls.showNetFields.value).toBe(false);

    // ...but the Admin overrides it back on, and the seed never re-forces it —
    // the overridden value is what gets submitted.
    component.form.controls.showNetFields.setValue(true);
    component.form.controls.title.setValue('Nest project with nets after all');
    component.submit();

    expect(component.form.controls.showNetFields.value).toBe(true);
    expect(dialogRef.close).toHaveBeenCalledWith(
      jasmine.objectContaining({showNetFields: true}),
    );
  });

  it('does not force Netzfelder to any value when a non-Nestlingsberingung type is chosen (AC #3)', () => {
    const {component} = setup();

    // From the default-on state, a net-based type leaves the checkbox untouched.
    component.form.controls.projekttyp.setValue(Projekttyp.IWM);
    expect(component.form.controls.showNetFields.value).toBe(true);

    // And it does not force nets back on: an Admin who turned nets off keeps that
    // choice when they then pick a net-based type (the seed only pushes off, and
    // only for Nestlingsberingung — it never re-raises the checkbox).
    component.form.controls.showNetFields.setValue(false);
    component.form.controls.projekttyp.setValue(Projekttyp.IMS);
    expect(component.form.controls.showNetFields.value).toBe(false);

    // Nestlingsberingung → off, then another type must leave it off, not re-raise it.
    component.form.controls.projekttyp.setValue(Projekttyp.Nestlingsberingung);
    expect(component.form.controls.showNetFields.value).toBe(false);
    component.form.controls.projekttyp.setValue(Projekttyp.Zugvogelmonitoring);
    expect(component.form.controls.showNetFields.value).toBe(false);
  });

  // --- Projekt-Anlage-Parität (issue #389, PRD #384) -------------------------
  // The Anlegen-Dialog gained the four settings that used to need a follow-up
  // „Bearbeiten", and the inert Organisation-Picker gave way to a plain-text line.

  it('preselects the creating Admin as first Beringer, editable', () => {
    const {component} = setup();

    expect(component.form.controls.scientistIds.value).toEqual(['s-alice']);
    expect(component.form.controls.scientistIds.enabled).toBe(true);
  });

  it('starts the Beringer field empty and required when the creator has none', () => {
    // The invitation account path creates a Mitgliedschaft but no Scientist, so
    // /auth/me/ carries handle: null and there is nothing to preselect.
    const {component} = setup(makeData({currentBeringerHandle: null}));

    expect(component.form.controls.scientistIds.value).toEqual([]);
    expect(component.form.controls.scientistIds.invalid).toBe(true);
  });

  it('blocks submit while the Beringer field is empty', () => {
    const {component, dialogRef} = setup(makeData({currentBeringerHandle: null}));
    component.form.controls.title.setValue('Ohne Beringer');

    component.submit();

    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it('shows the active Organisation as plain text, with no picker to choose one', () => {
    const {fixture, component} = setup();

    expect(fixture.nativeElement.textContent).toContain('IWM Linz');
    expect(fixture.nativeElement.querySelector('[formcontrolname="organizationHandle"]')).toBeNull();
    expect('organizationHandle' in component.form.controls).toBe(false);
  });

  it('round-trips the four settings the Anlegen-Dialog gained into the result', () => {
    const {component, dialogRef} = setup();

    component.form.controls.title.setValue('Schilfgürtel');
    component.form.controls.scientistIds.setValue(['s-alice', 's-bob']);
    component.form.controls.showOptionalFields.setValue(true);
    component.form.controls.saisonStartMonth.setValue(11);
    component.form.controls.saisonEndMonth.setValue(3);
    component.submit();

    expect(dialogRef.close).toHaveBeenCalledWith(
      jasmine.objectContaining({
        scientistIds: ['s-alice', 's-bob'],
        showOptionalFields: true,
        saisonStartMonth: 11,
        saisonEndMonth: 3,
      }),
    );
  });

  it('leaves the Saison window unset by default, so „Keine" round-trips as null', () => {
    const {component, dialogRef} = setup();

    component.form.controls.title.setValue('Ohne Saison');
    component.submit();

    expect(dialogRef.close).toHaveBeenCalledWith(
      jasmine.objectContaining({saisonStartMonth: null, saisonEndMonth: null}),
    );
  });

  it('renders the fields in the Bearbeiten-Dialog’s order', () => {
    const {fixture} = setup();
    const text: string = fixture.nativeElement.textContent;

    const positions = [
      'Titel',
      'Beschreibung',
      'Organisation',
      'Wissenschaftler:innen',
      'Projekttyp',
      'Standard-Station',
      'Saison-Start',
      'Optionale Felder',
      'Netzfelder',
    ].map((label) => text.indexOf(label));

    expect(positions).not.toContain(-1);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});
