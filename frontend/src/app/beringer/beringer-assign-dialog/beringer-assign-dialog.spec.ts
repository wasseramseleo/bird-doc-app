import {ComponentFixture, TestBed} from '@angular/core/testing';
import {MatDialogRef, MAT_DIALOG_DATA} from '@angular/material/dialog';
import {provideNoopAnimations} from '@angular/platform-browser/animations';

import {
  BeringerAssignDialogComponent,
  BeringerAssignDialogData,
} from './beringer-assign-dialog';
import {Beringer} from '../../models/beringer.model';
import {Mitgliedschaft} from '../../models/mitgliedschaft.model';

function makeBeringer(overrides: Partial<Beringer> = {}): Beringer {
  return {
    id: 'free',
    handle: 'FRE',
    first_name: 'Frei',
    last_name: 'Beringer',
    full_name: 'Frei Beringer',
    is_member: false,
    account: null,
    ...overrides,
  };
}

function makeSeat(overrides: Partial<Mitgliedschaft> = {}): Mitgliedschaft {
  return {
    id: 's1',
    username: 'gap',
    email: 'gap@example.org',
    handle: null,
    rolle: 'mitglied',
    created: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function setup(data: BeringerAssignDialogData) {
  const dialogRef = jasmine.createSpyObj<MatDialogRef<BeringerAssignDialogComponent>>(
    'MatDialogRef',
    ['close'],
  );
  TestBed.configureTestingModule({
    imports: [BeringerAssignDialogComponent],
    providers: [
      provideNoopAnimations(),
      {provide: MatDialogRef, useValue: dialogRef},
      {provide: MAT_DIALOG_DATA, useValue: data},
    ],
  });
  const fixture: ComponentFixture<BeringerAssignDialogComponent> = TestBed.createComponent(
    BeringerAssignDialogComponent,
  );
  fixture.detectChanges();
  return {fixture, component: fixture.componentInstance, dialogRef};
}

describe('BeringerAssignDialogComponent', () => {
  it('closes with a link result when an existing Beringer is chosen', () => {
    const {component, dialogRef} = setup({seat: makeSeat(), candidates: [makeBeringer()]});

    component.beringerId.setValue('free');
    component.submit();

    expect(dialogRef.close).toHaveBeenCalledWith({mode: 'link', beringerId: 'free'});
  });

  it('blocks submission in verknüpfen mode until a Beringer is chosen', () => {
    const {component, dialogRef} = setup({seat: makeSeat(), candidates: [makeBeringer()]});

    component.submit();

    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it('closes with a create payload in neu-anlegen mode', () => {
    const {component, dialogRef} = setup({seat: makeSeat(), candidates: [makeBeringer()]});

    component.selectMode('create');
    component.createForm.controls.first_name.setValue('Nora');
    component.createForm.controls.last_name.setValue('Neu');
    component.submit();

    // The Kürzel is derived from the name while unset (Nora Neu → NNE).
    expect(dialogRef.close).toHaveBeenCalledWith({
      mode: 'create',
      payload: {first_name: 'Nora', last_name: 'Neu', handle: 'NNE'},
    });
  });

  it('defaults to neu anlegen when there is no Beringer to verknüpfen', () => {
    const {component} = setup({seat: makeSeat(), candidates: []});

    expect(component.mode()).toBe('create');
  });
});
