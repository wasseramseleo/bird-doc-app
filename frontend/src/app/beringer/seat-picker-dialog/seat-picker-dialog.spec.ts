import {ComponentFixture, TestBed} from '@angular/core/testing';
import {MatDialogRef, MAT_DIALOG_DATA} from '@angular/material/dialog';
import {provideNoopAnimations} from '@angular/platform-browser/animations';

import {SeatPickerDialogComponent, SeatPickerDialogData} from './seat-picker-dialog';
import {Mitgliedschaft} from '../../models/mitgliedschaft.model';

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

function setup(data: SeatPickerDialogData) {
  const dialogRef = jasmine.createSpyObj<MatDialogRef<SeatPickerDialogComponent>>('MatDialogRef', [
    'close',
  ]);
  TestBed.configureTestingModule({
    imports: [SeatPickerDialogComponent],
    providers: [
      provideNoopAnimations(),
      {provide: MatDialogRef, useValue: dialogRef},
      {provide: MAT_DIALOG_DATA, useValue: data},
    ],
  });
  const fixture: ComponentFixture<SeatPickerDialogComponent> =
    TestBed.createComponent(SeatPickerDialogComponent);
  fixture.detectChanges();
  return {fixture, component: fixture.componentInstance, dialogRef};
}

describe('SeatPickerDialogComponent', () => {
  it('closes with the chosen seat id', () => {
    const {component, dialogRef} = setup({
      beringerName: 'Nina Ohnekonto',
      seats: [makeSeat({id: 'free'})],
    });

    component.seatId.setValue('free');
    component.submit();

    expect(dialogRef.close).toHaveBeenCalledWith('free');
  });

  it('blocks submission and does not close until a seat is chosen', () => {
    const {component, dialogRef} = setup({
      beringerName: 'Nina Ohnekonto',
      seats: [makeSeat({id: 'free'})],
    });

    component.submit();

    expect(dialogRef.close).not.toHaveBeenCalled();
  });
});
