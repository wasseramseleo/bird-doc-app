import {ComponentFixture, TestBed} from '@angular/core/testing';
import {provideHttpClient} from '@angular/common/http';
import {HttpTestingController, provideHttpClientTesting} from '@angular/common/http/testing';
import {provideNoopAnimations} from '@angular/platform-browser/animations';
import {MatDialog} from '@angular/material/dialog';
import {MatSnackBar} from '@angular/material/snack-bar';
import {EMPTY, of} from 'rxjs';

import {StationenComponent} from './stationen';
import {RingingStation} from '../models/ringing-station.model';

let httpMock: HttpTestingController;

function page0<T>(results: T[]) {
  return {count: results.length, next: null, previous: null, results};
}

function makeStation(overrides: Partial<RingingStation> = {}): RingingStation {
  return {
    handle: 'tw-1',
    name: 'Teichwiese',
    place_code: 'AT-TW',
    country: 'AT',
    region: 'Wien',
    latitude: '48.1',
    longitude: '16.3',
    is_active: true,
    ...overrides,
  };
}

function setup() {
  TestBed.configureTestingModule({
    imports: [StationenComponent],
    providers: [provideHttpClient(), provideHttpClientTesting(), provideNoopAnimations()],
  });
  const fixture: ComponentFixture<StationenComponent> = TestBed.createComponent(StationenComponent);
  httpMock = TestBed.inject(HttpTestingController);
  return {fixture, component: fixture.componentInstance};
}

// Material services resolve through the component's own injector, so spy on the
// instance the component actually holds (not TestBed.inject, which can differ).
function spyOnSnackBar(fixture: ComponentFixture<StationenComponent>) {
  // onAction never emits here (EMPTY), so the snackbar's "Archivieren" action
  // isn't auto-triggered during a delete-refusal test.
  return spyOn(fixture.debugElement.injector.get(MatSnackBar), 'open').and.returnValue({
    onAction: () => EMPTY,
  } as never);
}

function spyOnDialog(fixture: ComponentFixture<StationenComponent>, afterClosed: unknown) {
  return spyOn(fixture.debugElement.injector.get(MatDialog), 'open').and.returnValue({
    afterClosed: () => of(afterClosed),
  } as never);
}

describe('StationenComponent', () => {
  afterEach(() => httpMock.verify());

  it('lists the org stations and distinguishes active from archived, requesting include_archived', () => {
    const {fixture} = setup();

    fixture.detectChanges(); // ngOnInit → load()
    const req = httpMock.expectOne(
      (r) => r.method === 'GET' && r.url.endsWith('/ringing-stations/'),
    );
    expect(req.request.params.get('include_archived')).toBe('true');
    req.flush(
      page0([
        makeStation({handle: 'a', name: 'Aktiv-Stelle', is_active: true}),
        makeStation({handle: 'z', name: 'Alt-Stelle', is_active: false}),
      ]),
    );
    fixture.detectChanges();

    const cards = fixture.nativeElement.querySelectorAll('.station-card');
    expect(cards.length).toBe(2);
    const names = Array.from(fixture.nativeElement.querySelectorAll('.station-card__name')).map(
      (e) => (e as HTMLElement).textContent?.trim(),
    );
    expect(names).toContain('Aktiv-Stelle');
    expect(names).toContain('Alt-Stelle');

    const archived = fixture.nativeElement.querySelector('.station-card--archived') as HTMLElement;
    expect(archived).toBeTruthy();
    expect(archived.textContent).toContain('Alt-Stelle');
    expect(archived.textContent).toContain('Archiviert');
  });

  it('archives a Station via PATCH {is_active:false}', () => {
    const {fixture, component} = setup();
    spyOnSnackBar(fixture);

    component.archive(makeStation({handle: 'tw-1', name: 'Teichwiese'}));

    const patch = httpMock.expectOne(
      (r) => r.method === 'PATCH' && r.url.endsWith('/ringing-stations/tw-1/'),
    );
    expect(patch.request.body).toEqual({is_active: false});
    patch.flush({});
    httpMock
      .expectOne((r) => r.method === 'GET' && r.url.endsWith('/ringing-stations/'))
      .flush(page0([]));
  });

  it('un-archives a Station via PATCH {is_active:true}', () => {
    const {fixture, component} = setup();
    spyOnSnackBar(fixture);

    component.unarchive(makeStation({handle: 'tw-1', is_active: false}));

    const patch = httpMock.expectOne(
      (r) => r.method === 'PATCH' && r.url.endsWith('/ringing-stations/tw-1/'),
    );
    expect(patch.request.body).toEqual({is_active: true});
    patch.flush({});
    httpMock
      .expectOne((r) => r.method === 'GET' && r.url.endsWith('/ringing-stations/'))
      .flush(page0([]));
  });

  it('hard-deletes a Station that has no Fänge (204) and reloads', () => {
    const {fixture, component} = setup();
    const snack = spyOnSnackBar(fixture);

    component.remove(makeStation({handle: 'tw-1'}));

    httpMock
      .expectOne((r) => r.method === 'DELETE' && r.url.endsWith('/ringing-stations/tw-1/'))
      .flush(null, {status: 204, statusText: 'No Content'});
    httpMock
      .expectOne((r) => r.method === 'GET' && r.url.endsWith('/ringing-stations/'))
      .flush(page0([]));
    expect(snack).toHaveBeenCalled();
  });

  it('surfaces the German refusal when a delete is blocked by Fänge (409)', () => {
    const {fixture, component} = setup();
    const snack = spyOnSnackBar(fixture);

    component.remove(makeStation({handle: 'tw-1'}));

    httpMock
      .expectOne((r) => r.method === 'DELETE' && r.url.endsWith('/ringing-stations/tw-1/'))
      .flush(
        {detail: 'Diese Station kann nicht gelöscht werden, weil ihr Fänge zugeordnet sind. Archiviere die Station stattdessen.'},
        {status: 409, statusText: 'Conflict'},
      );

    expect(snack).toHaveBeenCalled();
    expect(snack.calls.mostRecent().args[0] as string).toContain('kann nicht gelöscht werden');
    // A blocked delete does not reload the list — nothing changed.
  });

  it('creates a Station from the dialog result via POST and reloads', () => {
    const {fixture, component} = setup();
    spyOnSnackBar(fixture);
    const payload = {
      name: 'Neue Stelle',
      place_code: 'AT-N',
      country: '',
      region: '',
      latitude: '47.0',
      longitude: '15.4',
    };
    spyOnDialog(fixture, payload);

    component.openCreateDialog();

    const post = httpMock.expectOne(
      (r) => r.method === 'POST' && r.url.endsWith('/ringing-stations/'),
    );
    expect(post.request.body).toEqual(payload);
    post.flush(makeStation({name: 'Neue Stelle'}));
    httpMock
      .expectOne((r) => r.method === 'GET' && r.url.endsWith('/ringing-stations/'))
      .flush(page0([]));
  });
});
