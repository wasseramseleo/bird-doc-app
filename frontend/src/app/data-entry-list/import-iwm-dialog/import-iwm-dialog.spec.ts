import {ComponentFixture, TestBed} from '@angular/core/testing';
import {MatDialogRef, MAT_DIALOG_DATA} from '@angular/material/dialog';
import {NoopAnimationsModule} from '@angular/platform-browser/animations';
import {of, throwError} from 'rxjs';

import {ApiService} from '../../service/api.service';
import {ImportPreview, ImportResult} from '../../models/iwm-import.model';
import {ImportIwmDialogComponent} from './import-iwm-dialog';

describe('ImportIwmDialogComponent', () => {
  let fixture: ComponentFixture<ImportIwmDialogComponent>;
  let component: ImportIwmDialogComponent;
  let api: jasmine.SpyObj<ApiService>;
  let dialogRef: jasmine.SpyObj<MatDialogRef<ImportIwmDialogComponent, boolean>>;

  const preview: ImportPreview = {
    importable: 2,
    duplicates: 0,
    errors: [{row: 4, reason: 'Unbekannte Art: \'Ferkelvogel\'.'}],
    warnings: [],
    toCreate: {beringer: [], stationen: []},
    cap: {limit: 5000, exceeded: false},
  };

  const result: ImportResult = {
    created: 2,
    duplicatesSkipped: 0,
    errors: [{row: 4, reason: 'Unbekannte Art: \'Ferkelvogel\'.'}],
    createdBeringer: [],
    createdStationen: [],
  };

  function selectFile(): File {
    const file = new File(['xlsx'], 'meldung.xlsx');
    component.onFileSelected({target: {files: [file], value: ''}} as unknown as Event);
    fixture.detectChanges();
    return file;
  }

  beforeEach(async () => {
    api = jasmine.createSpyObj('ApiService', ['importIwmDryRun', 'importIwmCommit']);
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);

    await TestBed.configureTestingModule({
      imports: [ImportIwmDialogComponent, NoopAnimationsModule],
      providers: [
        {provide: ApiService, useValue: api},
        {provide: MatDialogRef, useValue: dialogRef},
        {provide: MAT_DIALOG_DATA, useValue: {projectId: 'proj-1', projectTitle: 'Herbst'}},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ImportIwmDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('runs the full flow: file-select → preview → confirm → result', () => {
    api.importIwmDryRun.and.returnValue(of(preview));
    api.importIwmCommit.and.returnValue(of(result));

    // 1. Choosing a file triggers the dry-run for this project (nothing written).
    const file = selectFile();
    expect(api.importIwmDryRun).toHaveBeenCalledWith('proj-1', file);
    expect(component.phase()).toBe('preview');

    // The preview renders the importable count and the per-row errors.
    const previewText = fixture.nativeElement.textContent as string;
    expect(previewText).toContain('2');
    expect(previewText).toContain('Zeile 4');

    // 2. Confirming commits the *same* file.
    component.confirmImport();
    fixture.detectChanges();
    expect(api.importIwmCommit).toHaveBeenCalledWith('proj-1', file);
    expect(component.phase()).toBe('result');

    // 3. The result summary is shown (created count).
    const resultEl = fixture.nativeElement.querySelector('[data-testid="result"]') as HTMLElement;
    expect(resultEl.textContent).toContain('2');

    // 4. Finishing closes with true so the caller refreshes the list.
    component.finish();
    expect(dialogRef.close).toHaveBeenCalledWith(true);
  });

  it('cancelling after the preview writes nothing and closes with false', () => {
    api.importIwmDryRun.and.returnValue(of(preview));

    selectFile();
    expect(component.phase()).toBe('preview');

    component.cancel();

    expect(api.importIwmCommit).not.toHaveBeenCalled();
    expect(dialogRef.close).toHaveBeenCalledWith(false);
  });

  it('surfaces a structural fast-fail message and stays on the select step', () => {
    api.importIwmDryRun.and.returnValue(
      throwError(() => ({error: {file: 'Das Blatt „Fangdaten“ fehlt in der Datei.'}})),
    );

    selectFile();

    expect(component.phase()).toBe('select');
    expect(component.errorMessage()).toContain('Fangdaten');
    expect(api.importIwmCommit).not.toHaveBeenCalled();
  });
});
