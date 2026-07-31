import {ComponentFixture, TestBed} from '@angular/core/testing';
import {MAT_DIALOG_DATA, MatDialogRef} from '@angular/material/dialog';
import {MatSnackBar} from '@angular/material/snack-bar';
import {NoopAnimationsModule} from '@angular/platform-browser/animations';
import {of, throwError} from 'rxjs';

import {ApiService} from '../../service/api.service';
import {FeedbackDialogComponent, FeedbackDialogData} from './feedback-dialog';

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

/**
 * „Fehler melden" (#449): **derselbe** Dialog, nur vorbefüllt. Ein zweiter
 * Dialog wird nicht gebaut — das Feld ist Freitext, also bleibt auch
 * `feedback_view` unangetastet.
 */
describe('FeedbackDialogComponent — vorbefüllt aus einem Fehlschlag (#449)', () => {
  const VORLAGE =
    '\n\nTechnische Angaben (bitte stehen lassen):\n' +
    'Endpunkt: https://app.birddoc.eu/api/birds/data-entries/\n' +
    'Status: 500\n' +
    'Zeitpunkt: 2026-07-31T05:12:43.000Z\n' +
    'Bildschirm: /data-entry\n' +
    'Version: aktuell\n';

  let fixture: ComponentFixture<FeedbackDialogComponent>;
  let api: jasmine.SpyObj<ApiService>;

  beforeEach(async () => {
    api = jasmine.createSpyObj('ApiService', ['sendFeedback']);

    await TestBed.configureTestingModule({
      imports: [FeedbackDialogComponent, NoopAnimationsModule],
      providers: [
        {provide: ApiService, useValue: api},
        {provide: MatDialogRef, useValue: jasmine.createSpyObj('MatDialogRef', ['close'])},
        {provide: MatSnackBar, useValue: jasmine.createSpyObj('MatSnackBar', ['open'])},
        {provide: MAT_DIALOG_DATA, useValue: {prefill: VORLAGE} satisfies FeedbackDialogData},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FeedbackDialogComponent);
    fixture.detectChanges();
  });

  const textarea = (): HTMLTextAreaElement =>
    (fixture.nativeElement as HTMLElement).querySelector('textarea')!;

  it('trägt die technischen Angaben schon im Feld — nichts ist abzutippen', () => {
    expect(textarea().value).toBe(VORLAGE);
  });

  it('setzt den Cursor über die Angaben — das Mitglied schreibt zuerst', () => {
    expect(textarea().selectionStart).toBe(0);
    expect(textarea().selectionEnd).toBe(0);
  });

  it('schickt die eigenen Worte samt mitgereister Angaben ab', () => {
    api.sendFeedback.and.returnValue(of(undefined));
    fixture.componentInstance.form.controls.message.setValue(`Beim Speichern hängt es.${VORLAGE}`);

    fixture.componentInstance.submit();

    const gesendet = api.sendFeedback.calls.mostRecent().args[0];
    expect(gesendet).toContain('Beim Speichern hängt es.');
    expect(gesendet).toContain('Endpunkt: https://app.birddoc.eu/api/birds/data-entries/');
    expect(gesendet).toContain('Status: 500');
    expect(gesendet).toContain('Version: aktuell');
  });
});
