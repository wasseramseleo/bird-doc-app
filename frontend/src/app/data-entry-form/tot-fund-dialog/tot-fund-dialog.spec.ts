import { TestBed } from '@angular/core/testing';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { TotFundDialogComponent, TotFundDialogData } from './tot-fund-dialog';

function setup(data: TotFundDialogData) {
  const dialogRef = jasmine.createSpyObj<MatDialogRef<TotFundDialogComponent, string>>(
    'MatDialogRef',
    ['close'],
  );
  TestBed.configureTestingModule({
    imports: [TotFundDialogComponent],
    providers: [
      { provide: MatDialogRef, useValue: dialogRef },
      { provide: MAT_DIALOG_DATA, useValue: data },
      provideNoopAnimations(),
    ],
  });
  const fixture = TestBed.createComponent(TotFundDialogComponent);
  fixture.detectChanges();
  return { component: fixture.componentInstance, dialogRef };
}

describe('TotFundDialogComponent', () => {
  it('pre-fills the Todesumstände passed in (an edited Tot-Fund)', () => {
    const { component } = setup({ umstaende: 'unter dem Netz' });

    expect(component.form.controls.umstaende.value).toBe('unter dem Netz');
  });

  it('closes with the trimmed Todesumstände on confirm', () => {
    const { component, dialogRef } = setup({ umstaende: '' });

    component.form.controls.umstaende.setValue('  Beifang im Netz  ');
    component.confirm();

    expect(dialogRef.close).toHaveBeenCalledWith('Beifang im Netz');
  });

  it('does not close when the Todesumstände is blank (required)', () => {
    const { component, dialogRef } = setup({ umstaende: '' });

    component.confirm();

    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it('closes with no value on cancel (leaves the capture un-marked)', () => {
    const { component, dialogRef } = setup({ umstaende: '' });

    component.cancel();

    expect(dialogRef.close).toHaveBeenCalledWith();
  });
});
