import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';

import { DataEntryFormComponent } from './data-entry-form';

describe('DataEntryFormComponent', () => {
  let component: DataEntryFormComponent;
  let fixture: ComponentFixture<DataEntryFormComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DataEntryFormComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DataEntryFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('creating a Beringer inline from an unknown Kürzel', () => {
    const dialogMock = { open: jasmine.createSpy('open') };
    let httpMock: HttpTestingController;

    beforeEach(async () => {
      TestBed.resetTestingModule();
      dialogMock.open.calls.reset();
      await TestBed.configureTestingModule({
        imports: [DataEntryFormComponent],
        providers: [
          provideRouter([]),
          provideHttpClient(),
          provideHttpClientTesting(),
          provideNoopAnimations(),
        ],
      })
        .overrideComponent(DataEntryFormComponent, {
          add: { providers: [{ provide: MatDialog, useValue: dialogMock }] },
        })
        .compileComponents();

      fixture = TestBed.createComponent(DataEntryFormComponent);
      component = fixture.componentInstance;
      httpMock = TestBed.inject(HttpTestingController);
      fixture.detectChanges();
    });

    it('opens the dialog with the typed Kürzel pre-filled', () => {
      dialogMock.open.and.returnValue({ afterClosed: () => of(undefined) });

      component.onCreateBeringer('FRE');

      expect(dialogMock.open).toHaveBeenCalled();
      const config = dialogMock.open.calls.mostRecent().args[1];
      expect(config.data).toEqual({ handle: 'FRE' });
    });

    it('creates the Beringer and selects it into the staff field on save', () => {
      const created = { id: '7', handle: 'FRE', full_name: 'Filip Reiter' };
      dialogMock.open.and.returnValue({
        afterClosed: () => of({ first_name: 'Filip', last_name: 'Reiter', handle: 'FRE' }),
      });

      component.onCreateBeringer('FRE');

      const req = httpMock.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/birds/scientists/'),
      );
      expect(req.request.body).toEqual({ first_name: 'Filip', last_name: 'Reiter', handle: 'FRE' });
      req.flush(created);

      expect(component.entryForm.get('staff')!.value).toEqual(created);
    });
  });
});
