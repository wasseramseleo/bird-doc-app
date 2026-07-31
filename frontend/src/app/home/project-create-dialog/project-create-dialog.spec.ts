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
import {
  OPTIONAL_FIELD_LABELS,
  OPTIONAL_FIELD_ORDER,
  OptionalField,
  Projekttyp,
} from '../../models/project.model';
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

  // --- Optionale Felder (ADR 0035, issue #430) -------------------------------
  // One „angehakt = sichtbar" checkbox per vocabulary entry — the same control the
  // Bearbeiten-Dialog shows. Stored is what was un-ticked.

  it('offers one checkbox per optional field, all ticked by default', () => {
    const {fixture, component} = setup();

    expect(Object.keys(component.form.controls.optionalFields.controls)).toEqual([
      ...OPTIONAL_FIELD_ORDER,
    ]);
    expect(Object.values(component.form.controls.optionalFields.getRawValue())).toEqual(
      OPTIONAL_FIELD_ORDER.map(() => true),
    );
    for (const label of Object.values(OPTIONAL_FIELD_LABELS)) {
      expect(fixture.nativeElement.textContent).toContain(label);
    }
  });

  it('submits an empty opt-out list when the Admin never touches a checkbox', () => {
    // US 33: a new Projekt nobody configured shows every optional field.
    const {component, dialogRef} = setup();

    component.form.controls.title.setValue('Unangetastet');
    component.submit();

    expect(dialogRef.close).toHaveBeenCalledWith(
      jasmine.objectContaining({hiddenOptionalFields: []}),
    );
  });

  it('submits exactly the un-ticked fields as the opt-out list', () => {
    // The inversion happens on save: the display follows the Admin's expectation
    // („angehakt = sichtbar"), the storage follows the opt-out rule.
    const {component, dialogRef} = setup();

    component.form.controls.title.setValue('Nur Parasit');
    component.form.controls.optionalFields.controls[OptionalField.Hungerstreifen].setValue(false);
    component.form.controls.optionalFields.controls[OptionalField.NetzBlock].setValue(false);
    component.submit();

    expect(dialogRef.close).toHaveBeenCalledWith(
      jasmine.objectContaining({
        hiddenOptionalFields: [OptionalField.Hungerstreifen, OptionalField.NetzBlock],
      }),
    );
  });

  it('does not let the Projekttyp preset the Optionale Felder', () => {
    // ADR 0023 permits the type to seed the default; ADR 0035 leaves the permission
    // unused, so two Projekte created the same way never differ silently.
    const {component} = setup();

    component.form.controls.projekttyp.setValue(Projekttyp.Nestlingsberingung);

    expect(component.form.controls.optionalFields.controls[OptionalField.NetzBlock].value).toBe(
      true,
    );
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
    // Set away from the default (ticked) so this genuinely proves the round-trip
    // rather than passing on the default value.
    component.form.controls.optionalFields.controls[OptionalField.CplPlus].setValue(false);
    component.form.controls.saisonStartMonth.setValue(11);
    component.form.controls.saisonEndMonth.setValue(3);
    component.submit();

    expect(dialogRef.close).toHaveBeenCalledWith(
      jasmine.objectContaining({
        scientistIds: ['s-alice', 's-bob'],
        hiddenOptionalFields: [OptionalField.CplPlus],
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

  // --- Wochengrenze (ADR 0036, issue #431) -----------------------------------
  // Anlage und Bearbeitung tragen dieselben zwei Eingaben neben dem
  // Saison-Fenster. Nicht abwählbar: ein neues Projekt startet auf Montag 00:00.

  it('starts a new Projekt on the Montag-00:00 Wochengrenze', () => {
    const {fixture, component} = setup();

    expect(component.form.controls.wochengrenzeWeekday.value).toBe(0);
    expect(component.form.controls.wochengrenzeTime.value).toBe('00:00');
    expect(fixture.nativeElement.textContent).toContain('Wochengrenze');
    expect(fixture.nativeElement.textContent).toContain('Samstag');
  });

  it('round-trips the chosen Wochengrenze into the dialog result', () => {
    const {component, dialogRef} = setup();

    component.form.controls.title.setValue('Samstagsprojekt');
    component.form.controls.wochengrenzeWeekday.setValue(5);
    component.form.controls.wochengrenzeTime.setValue('12:00');
    component.submit();

    expect(dialogRef.close).toHaveBeenCalledWith(
      jasmine.objectContaining({wochengrenzeWeekday: 5, wochengrenzeTime: '12:00'}),
    );
  });

  it('reads an emptied Uhrzeit as midnight rather than leaving the Wochengrenze unset', () => {
    const {component, dialogRef} = setup();

    component.form.controls.title.setValue('Ohne Uhrzeit');
    component.form.controls.wochengrenzeWeekday.setValue(5);
    component.form.controls.wochengrenzeTime.setValue('');
    component.submit();

    expect(dialogRef.close).toHaveBeenCalledWith(
      jasmine.objectContaining({wochengrenzeWeekday: 5, wochengrenzeTime: '00:00'}),
    );
  });

  it('renders the fields in the Bearbeiten-Dialog’s order', () => {
    const {fixture} = setup();
    const text: string = fixture.nativeElement.textContent;

    const positions = [
      'Titel',
      'Beschreibung',
      'Organisation',
      'Beringer:innen',
      'Projekttyp',
      'Standard-Station',
      'Saison-Start',
      'Wochengrenze',
      'Optionale Felder',
    ].map((label) => text.indexOf(label));

    expect(positions).not.toContain(-1);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});
