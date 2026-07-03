import {ComponentFixture, TestBed} from '@angular/core/testing';
import {MatDialogRef, MAT_DIALOG_DATA} from '@angular/material/dialog';
import {provideNoopAnimations} from '@angular/platform-browser/animations';

import {BeringerFormDialogComponent, BeringerFormDialogData} from './beringer-form-dialog';
import {Beringer} from '../../models/beringer.model';

function makeBeringer(overrides: Partial<Beringer> = {}): Beringer {
  return {
    id: '1',
    handle: 'FRE',
    first_name: 'Filip',
    last_name: 'Reiter',
    full_name: 'Filip Reiter',
    is_member: false,
    account: null,
    ...overrides,
  };
}

function setup(data: BeringerFormDialogData) {
  const dialogRef = jasmine.createSpyObj<MatDialogRef<BeringerFormDialogComponent>>('MatDialogRef', [
    'close',
  ]);
  TestBed.configureTestingModule({
    imports: [BeringerFormDialogComponent],
    providers: [
      provideNoopAnimations(),
      {provide: MatDialogRef, useValue: dialogRef},
      {provide: MAT_DIALOG_DATA, useValue: data},
    ],
  });
  const fixture: ComponentFixture<BeringerFormDialogComponent> =
    TestBed.createComponent(BeringerFormDialogComponent);
  fixture.detectChanges();
  return {fixture, component: fixture.componentInstance, dialogRef};
}

describe('BeringerFormDialogComponent', () => {
  it('derives the Kürzel from the names when adding and none was typed', () => {
    const {component, dialogRef} = setup({});

    expect(component.isEdit).toBeFalse();
    component.form.controls.first_name.setValue('Filip');
    component.form.controls.last_name.setValue('Reiter');
    component.submit();

    expect(dialogRef.close).toHaveBeenCalledWith({
      first_name: 'Filip',
      last_name: 'Reiter',
      handle: 'FRE',
    });
  });

  it('keeps an editable, user-typed Kürzel instead of deriving it from the names', () => {
    const {component, dialogRef} = setup({});

    // The user types the Kürzel by hand: it must be respected (editable) and not
    // rewritten when the names are then filled in.
    component.form.controls.handle.setValue('ZZZ');
    component.form.controls.first_name.setValue('Filip');
    component.form.controls.last_name.setValue('Reiter');
    component.submit();

    expect(dialogRef.close).toHaveBeenCalledWith({
      first_name: 'Filip',
      last_name: 'Reiter',
      handle: 'ZZZ',
    });
  });

  it('pre-fills the form from the Beringer in edit mode', () => {
    const {component} = setup({beringer: makeBeringer()});

    expect(component.isEdit).toBeTrue();
    expect(component.form.getRawValue()).toEqual({
      first_name: 'Filip',
      last_name: 'Reiter',
      handle: 'FRE',
    });
  });

  it('does not rewrite an already-set Kürzel when the name is edited', () => {
    const {component, dialogRef} = setup({beringer: makeBeringer({handle: 'FRE'})});

    // Editing the name must leave the existing Kürzel untouched (issue #207).
    component.form.controls.first_name.setValue('Franz');
    component.form.controls.last_name.setValue('Xaver');
    component.submit();

    expect(dialogRef.close).toHaveBeenCalledWith({
      first_name: 'Franz',
      last_name: 'Xaver',
      handle: 'FRE',
    });
  });

  it('blocks an incomplete submission and shows German validation messages', () => {
    const {fixture, component, dialogRef} = setup({});

    component.submit();
    fixture.detectChanges();

    expect(dialogRef.close).not.toHaveBeenCalled();
    const errors = Array.from(fixture.nativeElement.querySelectorAll('mat-error')).map((e) =>
      (e as HTMLElement).textContent?.trim(),
    );
    expect(errors).toContain('Vorname ist erforderlich.');
    expect(errors).toContain('Nachname ist erforderlich.');
  });
});
