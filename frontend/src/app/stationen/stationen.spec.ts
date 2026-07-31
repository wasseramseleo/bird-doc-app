import {ComponentFixture, TestBed} from '@angular/core/testing';
import {provideHttpClient} from '@angular/common/http';
import {HttpTestingController, provideHttpClientTesting} from '@angular/common/http/testing';
import {provideNoopAnimations} from '@angular/platform-browser/animations';
import {MatDialog} from '@angular/material/dialog';
import {MatSnackBar} from '@angular/material/snack-bar';
import {EMPTY, of} from 'rxjs';

import {StationenComponent} from './stationen';
import {AppIconEmptyDirective, AppIconErrorDirective} from '../shared/app-icons';
import {renderedGlyph, seamGlyph} from '../shared/app-icons.testing';
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
  // Every remaining snackbar here is an Erfolgsmeldung (#448) and none carries an
  // action; `onAction` is stubbed with EMPTY only so the returned ref is complete.
  return spyOn(fixture.debugElement.injector.get(MatSnackBar), 'open').and.returnValue({
    onAction: () => EMPTY,
  } as never);
}

// The write tests assert on the *rendered* screen, so the list has to be on it
// first: ngOnInit's load has to have run and been answered before a gesture.
function renderList(fixture: ComponentFixture<StationenComponent>, stations: RingingStation[] = []) {
  fixture.detectChanges();
  httpMock
    .expectOne((r) => r.method === 'GET' && r.url.endsWith('/ringing-stations/'))
    .flush(page0(stations));
  fixture.detectChanges();
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

  // #446 (ADR 0037): bis hierher setzte ein gescheitertes Laden nur `loading`
  // zurück und toastete drei Sekunden — danach stand dieselbe leere Liste da wie
  // bei einer Organisation ohne Station. „Es sind noch keine Stationen angelegt"
  // und „Stationen konnten nicht geladen werden" waren nicht zu unterscheiden.
  describe('In-Place-Ladefehler', () => {
    it('renders the in-place error state instead of an empty list when the load fails', () => {
      const {fixture} = setup();
      const snack = spyOnSnackBar(fixture);

      fixture.detectChanges();
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/ringing-stations/'))
        .flush({detail: 'Die Datenbank antwortet gerade nicht.'}, {status: 500, statusText: 'Server Error'});
      fixture.detectChanges();

      const zustand = fixture.nativeElement.querySelector('[data-testid="load-error"]');
      expect(zustand).not.toBeNull();
      expect(zustand.textContent).toContain('Stationen konnten nicht geladen werden.');
      expect(zustand.textContent).toContain('Die Datenbank antwortet gerade nicht.');
      // Der leere Zustand darf hier nicht mitlaufen — das war ja der Defekt.
      expect(fixture.nativeElement.textContent).not.toContain('keine Stationen angelegt');
      expect(fixture.nativeElement.querySelector('mat-spinner')).toBeNull();
      // Der kaputte Zustand trägt den Vogel des kaputten, nicht den des leeren.
      expect(seamGlyph(fixture, AppIconErrorDirective)).toBeTruthy();
      expect(seamGlyph(fixture, AppIconEmptyDirective)).toBe('');
      // Nichts an einem gescheiterten Laden ist mehr flüchtig — und ein Laden
      // bekommt kein Banner (ADR 0037, Moment-Achse).
      expect(snack).not.toHaveBeenCalled();
      expect(fixture.nativeElement.querySelector('[data-testid="failure-banner"]')).toBeNull();
    });

    it('reloads on „Erneut laden" and recovers on success', () => {
      const {fixture} = setup();
      spyOnSnackBar(fixture);

      fixture.detectChanges();
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/ringing-stations/'))
        .error(new ProgressEvent('error'), {status: 0, statusText: 'Unknown Error'});
      fixture.detectChanges();

      (fixture.nativeElement as HTMLElement)
        .querySelector<HTMLButtonElement>('[data-testid="load-error-reload"]')!
        .click();
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/ringing-stations/'))
        .flush(page0([makeStation({handle: 'a', name: 'Aktiv-Stelle'})]));
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('[data-testid="load-error"]')).toBeNull();
      expect(fixture.nativeElement.querySelectorAll('.station-card').length).toBe(1);
    });
  });

  it('shows an empty state with the named App-Icon when the org has no Station', () => {
    const {fixture} = setup();

    fixture.detectChanges();
    httpMock
      .expectOne((r) => r.method === 'GET' && r.url.endsWith('/ringing-stations/'))
      .flush(page0([]));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.station-card')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('keine Stationen angelegt');
    // #439: am gezeichneten Ergebnis geprüft, nicht am Marker im Template. Nach
    // `mat-icon[app-icon-empty]` zu suchen hieße, das Attribut zurückzulesen, das
    // das Template selbst hineinschreibt — ein vergessener `imports`-Eintrag
    // bliebe unsichtbar und das Icon im Browser leer.
    expect(renderedGlyph(fixture.nativeElement.querySelector('.stationen__empty mat-icon')))
      .toBeTruthy();
    // ...und gezeichnet hat es der Name des *leeren* Zustands.
    expect(seamGlyph(fixture, AppIconEmptyDirective)).toBeTruthy();
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

  // #448 (ADR 0037): eine zurückgewiesene Schreibung landet im Banner, dort wo
  // die Geste stattfand — und verfällt nicht. Bis hierher toastete sie drei
  // Sekunden, und der Org-Admin bekam für eine abgelehnte Station nicht denselben
  // brauchbaren Grund wie der Beringer für einen abgelehnten Fang.
  describe('Schreib-Banner', () => {
    it('surfaces the German refusal in the banner when a delete is blocked by Fänge (409)', () => {
      const {fixture, component} = setup();
      const snack = spyOnSnackBar(fixture);
      renderList(fixture, [makeStation({handle: 'tw-1'})]);

      component.remove(makeStation({handle: 'tw-1'}));

      httpMock
        .expectOne((r) => r.method === 'DELETE' && r.url.endsWith('/ringing-stations/tw-1/'))
        .flush(
          {detail: 'Diese Station kann nicht gelöscht werden, weil ihr Fänge zugeordnet sind. Archiviere die Station stattdessen.'},
          {status: 409, statusText: 'Conflict'},
        );
      fixture.detectChanges();

      const banner = fixture.nativeElement.querySelector('[data-testid="failure-banner"]');
      expect(banner).not.toBeNull();
      expect(banner.textContent).toContain('kann nicht gelöscht werden');
      expect(snack).not.toHaveBeenCalled();
      // A blocked delete does not reload the list — nothing changed.
    });

    it('renders the server sentence of a refused create in the banner, not in a snackbar', () => {
      const {fixture, component} = setup();
      const snack = spyOnSnackBar(fixture);
      const payload = {
        name: 'Neue Stelle',
        place_code: 'AT-N',
        country: '',
        region: '',
        latitude: '47.0',
        longitude: '15.4',
      };
      renderList(fixture);
      spyOnDialog(fixture, payload);

      component.openCreateDialog();
      httpMock
        .expectOne((r) => r.method === 'POST' && r.url.endsWith('/ringing-stations/'))
        .flush(
          {
            place_code: ['Dieses Ortskürzel ist in deiner Organisation bereits vergeben.'],
            errors: [
              {
                field: 'place_code',
                code: 'unique',
                detail: 'Dieses Ortskürzel ist in deiner Organisation bereits vergeben.',
              },
            ],
          },
          {status: 400, statusText: 'Bad Request'},
        );
      fixture.detectChanges();

      const banner = fixture.nativeElement.querySelector('[data-testid="failure-banner"]');
      expect(banner.textContent).toContain('Ortskürzel ist in deiner Organisation bereits vergeben');
      expect(banner.textContent).toContain('Speichern abgelehnt');
      expect(snack).not.toHaveBeenCalled();
    });

    it('repeats the refused write on „Erneut versuchen" and clears the banner on success', () => {
      const {fixture, component} = setup();
      spyOnSnackBar(fixture);
      renderList(fixture, [makeStation({handle: 'tw-1', name: 'Teichwiese'})]);

      component.archive(makeStation({handle: 'tw-1', name: 'Teichwiese'}));
      httpMock
        .expectOne((r) => r.method === 'PATCH' && r.url.endsWith('/ringing-stations/tw-1/'))
        .flush({detail: 'Die Datenbank antwortet gerade nicht.'}, {status: 503, statusText: 'Service Unavailable'});
      fixture.detectChanges();

      (fixture.nativeElement as HTMLElement)
        .querySelector<HTMLButtonElement>('[data-testid="failure-erneut"]')!
        .click();
      httpMock
        .expectOne((r) => r.method === 'PATCH' && r.url.endsWith('/ringing-stations/tw-1/'))
        .flush({});
      httpMock
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/ringing-stations/'))
        .flush(page0([]));
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('[data-testid="failure-banner"]')).toBeNull();
    });
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
