import {ComponentFixture, TestBed} from '@angular/core/testing';
import {MatDialogRef, MAT_DIALOG_DATA} from '@angular/material/dialog';
import {provideNoopAnimations} from '@angular/platform-browser/animations';

import {StationFormDialogComponent, StationFormDialogData} from './station-form-dialog';
import {RingingStation} from '../../models/ringing-station.model';

function setup(data: StationFormDialogData) {
  const dialogRef = jasmine.createSpyObj<MatDialogRef<StationFormDialogComponent>>('MatDialogRef', [
    'close',
  ]);
  TestBed.configureTestingModule({
    imports: [StationFormDialogComponent],
    providers: [
      provideNoopAnimations(),
      {provide: MatDialogRef, useValue: dialogRef},
      {provide: MAT_DIALOG_DATA, useValue: data},
    ],
  });
  const fixture: ComponentFixture<StationFormDialogComponent> =
    TestBed.createComponent(StationFormDialogComponent);
  fixture.detectChanges();
  return {fixture, component: fixture.componentInstance, dialogRef};
}

describe('StationFormDialogComponent', () => {
  it('blocks an incomplete submission and shows German validation messages', () => {
    const {fixture, component, dialogRef} = setup({});

    component.submit();
    fixture.detectChanges();

    expect(dialogRef.close).not.toHaveBeenCalled();
    const errors = Array.from(fixture.nativeElement.querySelectorAll('mat-error')).map((e) =>
      (e as HTMLElement).textContent?.trim(),
    );
    expect(errors).toContain('Name ist erforderlich.');
    expect(errors).toContain('Ortskodierung ist erforderlich.');
    expect(errors).toContain('Breitengrad ist erforderlich.');
    expect(errors).toContain('Längengrad ist erforderlich.');
  });

  it('closes with the payload when the required fields are supplied', () => {
    const {component, dialogRef} = setup({});

    component.form.setValue({
      name: 'Teichwiese',
      place_code: 'AT-TW',
      country: '',
      region: 'Wien',
      latitude: '48.1',
      longitude: '16.3',
    });
    component.submit();

    expect(dialogRef.close).toHaveBeenCalledWith({
      name: 'Teichwiese',
      place_code: 'AT-TW',
      country: '',
      region: 'Wien',
      latitude: '48.1',
      longitude: '16.3',
    });
  });

  it('pre-fills the form from the Station in edit mode', () => {
    const station: RingingStation = {
      handle: 'TW-1',
      name: 'Teichwiese',
      place_code: 'AT-TW',
      country: 'AT',
      region: 'Wien',
      latitude: '48.1',
      longitude: '16.3',
      is_active: true,
    };
    const {component} = setup({station});

    expect(component.isEdit).toBeTrue();
    expect(component.form.getRawValue()).toEqual({
      name: 'Teichwiese',
      place_code: 'AT-TW',
      country: 'AT',
      region: 'Wien',
      latitude: '48.1',
      longitude: '16.3',
    });
  });
});
