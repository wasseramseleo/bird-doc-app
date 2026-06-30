import {ComponentFixture, TestBed} from '@angular/core/testing';
import {MatDialogRef} from '@angular/material/dialog';
import {MatSnackBar} from '@angular/material/snack-bar';
import {NoopAnimationsModule} from '@angular/platform-browser/animations';
import {of, throwError} from 'rxjs';

import {ApiService} from '../../service/api.service';
import {FeedbackDialogComponent} from './feedback-dialog';

describe('FeedbackDialogComponent', () => {
  let fixture: ComponentFixture<FeedbackDialogComponent>;
  let component: FeedbackDialogComponent;
  let api: jasmine.SpyObj<ApiService>;
  let dialogRef: jasmine.SpyObj<MatDialogRef<FeedbackDialogComponent>>;
  let snackBar: jasmine.SpyObj<MatSnackBar>;

  beforeEach(async () => {
    api = jasmine.createSpyObj('ApiService', ['sendFeedback']);
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    snackBar = jasmine.createSpyObj('MatSnackBar', ['open']);

    await TestBed.configureTestingModule({
      imports: [FeedbackDialogComponent, NoopAnimationsModule],
      providers: [
        {provide: ApiService, useValue: api},
        {provide: MatDialogRef, useValue: dialogRef},
        {provide: MatSnackBar, useValue: snackBar},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FeedbackDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('does not send an empty message', () => {
    component.submit();

    expect(api.sendFeedback).not.toHaveBeenCalled();
    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it('does not send a whitespace-only message', () => {
    component.form.controls.message.setValue('    ');

    component.submit();

    expect(api.sendFeedback).not.toHaveBeenCalled();
  });

  it('emails the feedback (trimmed) and closes on success', () => {
    api.sendFeedback.and.returnValue(of(undefined));
    component.form.controls.message.setValue('  Der Export bricht ab.  ');

    component.submit();

    expect(api.sendFeedback).toHaveBeenCalledWith('Der Export bricht ab.');
    expect(dialogRef.close).toHaveBeenCalledWith(true);
    expect(snackBar.open).toHaveBeenCalled();
  });

  it('keeps the dialog open and warns the user when sending fails', () => {
    api.sendFeedback.and.returnValue(throwError(() => new Error('network')));
    component.form.controls.message.setValue('Etwas ist kaputt.');

    component.submit();

    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(snackBar.open).toHaveBeenCalled();
  });
});
