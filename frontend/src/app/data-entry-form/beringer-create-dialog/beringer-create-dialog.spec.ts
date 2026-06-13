import { TestBed } from '@angular/core/testing';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import {
  BeringerCreateDialogComponent,
  BeringerCreateDialogResult,
} from './beringer-create-dialog';

function setup(data: { handle: string }) {
  const dialogRef = jasmine.createSpyObj<MatDialogRef<BeringerCreateDialogComponent, BeringerCreateDialogResult>>(
    'MatDialogRef',
    ['close'],
  );
  TestBed.configureTestingModule({
    imports: [BeringerCreateDialogComponent],
    providers: [
      { provide: MatDialogRef, useValue: dialogRef },
      { provide: MAT_DIALOG_DATA, useValue: data },
      provideNoopAnimations(),
    ],
  });
  const fixture = TestBed.createComponent(BeringerCreateDialogComponent);
  fixture.detectChanges();
  return { component: fixture.componentInstance, dialogRef };
}

describe('BeringerCreateDialogComponent', () => {
  it('emits the Kürzel derived from the names when none was typed', () => {
    const { component, dialogRef } = setup({ handle: '' });

    component.form.controls.first_name.setValue('Filip');
    component.form.controls.last_name.setValue('Reiter');
    component.submit();

    expect(dialogRef.close).toHaveBeenCalledWith({
      first_name: 'Filip',
      last_name: 'Reiter',
      handle: 'FRE',
    });
  });

  it('preserves a pre-filled Kürzel instead of deriving from the names', () => {
    const { component, dialogRef } = setup({ handle: 'FRE' });

    component.form.controls.first_name.setValue('Franz');
    component.form.controls.last_name.setValue('Xaver');
    component.submit();

    expect(dialogRef.close).toHaveBeenCalledWith({
      first_name: 'Franz',
      last_name: 'Xaver',
      handle: 'FRE',
    });
  });

  it('does not close when first and last name are missing', () => {
    const { component, dialogRef } = setup({ handle: 'FRE' });

    component.submit();

    expect(dialogRef.close).not.toHaveBeenCalled();
  });
});
