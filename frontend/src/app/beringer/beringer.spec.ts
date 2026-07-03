import {ComponentFixture, TestBed} from '@angular/core/testing';
import {provideHttpClient} from '@angular/common/http';
import {HttpTestingController, provideHttpClientTesting} from '@angular/common/http/testing';
import {provideNoopAnimations} from '@angular/platform-browser/animations';
import {MatDialog} from '@angular/material/dialog';
import {MatSnackBar} from '@angular/material/snack-bar';
import {of} from 'rxjs';

import {BeringerComponent} from './beringer';
import {Beringer} from '../models/beringer.model';
import {Mitgliedschaft} from '../models/mitgliedschaft.model';
import {SeatPickerDialogData} from './seat-picker-dialog/seat-picker-dialog';
import {ConfirmDialogData} from '../shared/confirm-dialog/confirm-dialog';

let httpMock: HttpTestingController;

function page0<T>(results: T[]) {
  return {count: results.length, next: null, previous: null, results};
}

function makeBeringer(overrides: Partial<Beringer> = {}): Beringer {
  return {
    id: '1',
    handle: 'FRE',
    first_name: 'Filip',
    last_name: 'Reiter',
    full_name: 'Filip Reiter',
    is_member: false,
    account: null,
    ...overrides,
  };
}

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

function setup() {
  TestBed.configureTestingModule({
    imports: [BeringerComponent],
    providers: [provideHttpClient(), provideHttpClientTesting(), provideNoopAnimations()],
  });
  const fixture: ComponentFixture<BeringerComponent> = TestBed.createComponent(BeringerComponent);
  httpMock = TestBed.inject(HttpTestingController);
  return {fixture, component: fixture.componentInstance};
}

// Material services resolve through the component's own injector, so spy on the
// instance the component actually holds (not TestBed.inject, which can differ).
function spyOnSnackBar(fixture: ComponentFixture<BeringerComponent>) {
  return spyOn(fixture.debugElement.injector.get(MatSnackBar), 'open');
}

function spyOnDialog(fixture: ComponentFixture<BeringerComponent>, afterClosed: unknown) {
  return spyOn(fixture.debugElement.injector.get(MatDialog), 'open').and.returnValue({
    afterClosed: () => of(afterClosed),
  } as never);
}

describe('BeringerComponent', () => {
  afterEach(() => httpMock.verify());

  it('lists the org Beringer sorted by surname then first name, requesting GET /scientists/', () => {
    const {fixture} = setup();

    fixture.detectChanges(); // ngOnInit → load()
    const req = httpMock.expectOne((r) => r.method === 'GET' && r.url.endsWith('/scientists/'));
    req.flush(
      page0([
        makeBeringer({
          id: 'r',
          handle: 'JMU',
          first_name: 'Jana',
          last_name: 'Müller',
          full_name: 'Jana Müller',
        }),
        makeBeringer({
          id: 'a',
          handle: 'ABA',
          first_name: 'Anna',
          last_name: 'Bauer',
          full_name: 'Anna Bauer',
        }),
      ]),
    );
    fixture.detectChanges();

    const cards = fixture.nativeElement.querySelectorAll('.beringer-card');
    expect(cards.length).toBe(2);

    // Surname-then-first-name order: Bauer before Müller, regardless of server order.
    const names = Array.from(fixture.nativeElement.querySelectorAll('.beringer-card__name')).map(
      (e) => (e as HTMLElement).textContent?.trim(),
    );
    expect(names).toEqual(['Anna Bauer', 'Jana Müller']);

    // Each row surfaces the Kürzel (handle).
    const handles = Array.from(
      fixture.nativeElement.querySelectorAll('.beringer-card__handle'),
    ).map((e) => (e as HTMLElement).textContent?.trim());
    expect(handles).toContain('ABA');
    expect(handles).toContain('JMU');
  });

  it('badges an account-linked Beringer "Mitglied" and a no-account one "Ohne Konto"', () => {
    const {fixture} = setup();

    fixture.detectChanges();
    httpMock
      .expectOne((r) => r.method === 'GET' && r.url.endsWith('/scientists/'))
      .flush(
        page0([
          makeBeringer({
            id: 'm',
            handle: 'MAR',
            first_name: '',
            last_name: 'Moser',
            full_name: 'Mara Moser',
            is_member: true,
            account: {display_name: 'Mara Moser', email: 'mara@example.org', rolle: 'mitglied'},
          }),
          makeBeringer({
            id: 'n',
            handle: 'FRE',
            first_name: 'Filip',
            last_name: 'Reiter',
            full_name: 'Filip Reiter',
            is_member: false,
            account: null,
          }),
        ]),
      );
    fixture.detectChanges();

    const member = fixture.nativeElement.querySelector(
      '.beringer-card__badge--member',
    ) as HTMLElement;
    expect(member).withContext('Mitglied badge for the account-linked Beringer').toBeTruthy();
    expect(member.textContent).toContain('Mitglied');

    const noAccount = fixture.nativeElement.querySelector(
      '.beringer-card__badge--no-account',
    ) as HTMLElement;
    expect(noAccount).withContext('Ohne Konto badge for the no-account Beringer').toBeTruthy();
    expect(noAccount.textContent).toContain('Ohne Konto');
  });

  it('shows an empty-state message when the org has no Beringer', () => {
    const {fixture} = setup();

    fixture.detectChanges();
    httpMock
      .expectOne((r) => r.method === 'GET' && r.url.endsWith('/scientists/'))
      .flush(page0([]));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.beringer-card')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('keine Beringer');
  });

  it('adds a Beringer from the dialog result via POST /scientists/ and reloads', () => {
    const {fixture, component} = setup();
    spyOnSnackBar(fixture);
    const payload = {first_name: 'Nora', last_name: 'Neu', handle: 'NNE'};
    spyOnDialog(fixture, payload);

    component.openCreateDialog();

    const post = httpMock.expectOne((r) => r.method === 'POST' && r.url.endsWith('/scientists/'));
    expect(post.request.body).toEqual(payload);
    post.flush(makeBeringer({id: 'x', ...payload, full_name: 'Nora Neu'}));
    // A successful add reloads the list.
    httpMock.expectOne((r) => r.method === 'GET' && r.url.endsWith('/scientists/')).flush(page0([]));
  });

  it('edits a Beringer from the dialog result via PATCH /scientists/<id>/ and reloads', () => {
    const {fixture, component} = setup();
    spyOnSnackBar(fixture);
    const payload = {first_name: 'Nora', last_name: 'Neu', handle: 'NNE'};
    spyOnDialog(fixture, payload);

    component.openEditDialog(makeBeringer({id: '42', handle: 'FRE'}));

    const patch = httpMock.expectOne(
      (r) => r.method === 'PATCH' && r.url.endsWith('/scientists/42/'),
    );
    expect(patch.request.body).toEqual(payload);
    patch.flush(makeBeringer({id: '42', ...payload, full_name: 'Nora Neu'}));
    httpMock.expectOne((r) => r.method === 'GET' && r.url.endsWith('/scientists/')).flush(page0([]));
  });

  it('surfaces the German duplicate-Kürzel 400 message and does not reload', () => {
    const {fixture, component} = setup();
    const snack = spyOnSnackBar(fixture);
    const payload = {first_name: 'Nora', last_name: 'Neu', handle: 'FRE'};
    spyOnDialog(fixture, payload);

    component.openEditDialog(makeBeringer({id: '42', handle: 'NNE'}));

    httpMock
      .expectOne((r) => r.method === 'PATCH' && r.url.endsWith('/scientists/42/'))
      .flush(
        {handle: ['Dieses Kürzel ist bereits vergeben. Bitte wähle ein anderes Kürzel.']},
        {status: 400, statusText: 'Bad Request'},
      );

    expect(snack).toHaveBeenCalled();
    expect(snack.calls.mostRecent().args[0] as string).toContain('Kürzel');
    // A rejected save does not reload the list — nothing changed, so no GET.
  });

  // --- Link / unlink a Beringer to a seat (PRD #205, issue #209) -------------

  it('offers only eligible (handle==null) seats to the link picker', () => {
    const {fixture, component} = setup();
    // Cancelling the picker (afterClosed → undefined) means no PATCH follows.
    const dialogSpy = spyOnDialog(fixture, undefined);

    component.openLinkDialog(makeBeringer({id: '7', is_member: false}));

    httpMock
      .expectOne((r) => r.method === 'GET' && r.url.endsWith('/mitgliedschaften/'))
      .flush(
        page0([
          makeSeat({id: 'free', handle: null}),
          makeSeat({id: 'taken', username: 'mara', handle: 'MAR'}),
        ]),
      );

    // The picker is offered only the seat whose account is not yet a Beringer.
    expect(dialogSpy).toHaveBeenCalled();
    const config = dialogSpy.calls.mostRecent().args[1] as {data: SeatPickerDialogData};
    expect(config.data.seats.map((s) => s.id)).toEqual(['free']);
  });

  it('links a no-account Beringer to the chosen seat via PATCH {mitgliedschaft_id}', () => {
    const {fixture, component} = setup();
    spyOnSnackBar(fixture);
    // The picker resolves to the chosen seat id.
    spyOnDialog(fixture, 'seat-1');

    component.openLinkDialog(makeBeringer({id: '7', is_member: false}));

    httpMock
      .expectOne((r) => r.method === 'GET' && r.url.endsWith('/mitgliedschaften/'))
      .flush(page0([makeSeat({id: 'seat-1', handle: null})]));

    const patch = httpMock.expectOne(
      (r) => r.method === 'PATCH' && r.url.endsWith('/scientists/7/'),
    );
    expect(patch.request.body).toEqual({mitgliedschaft_id: 'seat-1'});
    patch.flush(makeBeringer({id: '7', is_member: true}));
    // A successful link reloads the list.
    httpMock.expectOne((r) => r.method === 'GET' && r.url.endsWith('/scientists/')).flush(page0([]));
  });

  it('shows the demote warning then unlinks via PATCH {mitgliedschaft_id: null}', () => {
    const {fixture, component} = setup();
    spyOnSnackBar(fixture);
    // The confirm (demote-warning) dialog resolves to true.
    const dialogSpy = spyOnDialog(fixture, true);

    component.openUnlinkDialog(makeBeringer({id: '42', is_member: true, full_name: 'Mara Moser'}));

    // The demote warning is shown before unlinking: it spells out that the account
    // keeps login + Rolle but loses Beringer identity and Projekt visibility.
    const config = dialogSpy.calls.mostRecent().args[1] as {data: ConfirmDialogData};
    expect(config.data.message).toContain('Rolle');
    expect(config.data.message).toContain('Projekt');

    const patch = httpMock.expectOne(
      (r) => r.method === 'PATCH' && r.url.endsWith('/scientists/42/'),
    );
    expect(patch.request.body).toEqual({mitgliedschaft_id: null});
    patch.flush(makeBeringer({id: '42', is_member: false}));
    httpMock.expectOne((r) => r.method === 'GET' && r.url.endsWith('/scientists/')).flush(page0([]));
  });

  it('does not unlink when the demote warning is cancelled', () => {
    const {fixture, component} = setup();
    const dialogSpy = spyOnDialog(fixture, false);

    component.openUnlinkDialog(makeBeringer({id: '42', is_member: true}));

    // The warning was shown, but a cancelled demote makes no PATCH and no reload —
    // httpMock.verify() (afterEach) would fail on any unexpected request.
    expect(dialogSpy).toHaveBeenCalled();
  });

  // --- Delete a Beringer: reassign-or-block (PRD #205, issue #208) ------------

  it('disables the delete action for a Mitglied with a hint to remove the account first', () => {
    const {fixture} = setup();

    fixture.detectChanges();
    httpMock
      .expectOne((r) => r.method === 'GET' && r.url.endsWith('/scientists/'))
      .flush(page0([makeBeringer({id: 'm', is_member: true, full_name: 'Mara Moser'})]));
    fixture.detectChanges();

    const del = fixture.nativeElement.querySelector(
      'button[aria-label="Beringer löschen"]',
    ) as HTMLButtonElement;
    expect(del).withContext('delete button rendered for the Mitglied row').toBeTruthy();
    // A Mitglied is never deleted from this screen — the action is disabled and the
    // hint points the Admin at member management.
    expect(del.disabled).toBeTrue();
    expect(del.getAttribute('title')).toContain('Mitgliederverwaltung');
  });

  it('names the Fänge count in the delete confirmation for a capture-owning Beringer', () => {
    const {fixture, component} = setup();
    // Cancel the confirm (afterClosed → false) so no DELETE follows.
    const dialogSpy = spyOnDialog(fixture, false);

    component.openDeleteDialog(
      makeBeringer({id: '9', is_member: false, full_name: 'Otto Owner', capture_count: 3}),
    );

    // The confirmation names how many Fänge will be reassigned to „Gelöschter Nutzer".
    const config = dialogSpy.calls.mostRecent().args[1] as {data: ConfirmDialogData};
    expect(config.data.message).toContain('3');
    expect(config.data.message).toContain('Fänge');
    expect(config.data.message).toContain('Gelöschter Nutzer');
  });

  it('deletes a no-account Beringer via DELETE /scientists/<id>/ and reloads', () => {
    const {fixture, component} = setup();
    spyOnSnackBar(fixture);
    // Confirm the delete (afterClosed → true).
    spyOnDialog(fixture, true);

    component.openDeleteDialog(
      makeBeringer({id: '9', is_member: false, full_name: 'Otto Owner', capture_count: 0}),
    );

    const del = httpMock.expectOne(
      (r) => r.method === 'DELETE' && r.url.endsWith('/scientists/9/'),
    );
    del.flush(null, {status: 204, statusText: 'No Content'});
    // A successful delete reloads the list.
    httpMock.expectOne((r) => r.method === 'GET' && r.url.endsWith('/scientists/')).flush(page0([]));
  });
});
