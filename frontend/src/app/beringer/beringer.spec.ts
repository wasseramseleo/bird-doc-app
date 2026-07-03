import {ComponentFixture, TestBed} from '@angular/core/testing';
import {provideHttpClient} from '@angular/common/http';
import {HttpTestingController, provideHttpClientTesting} from '@angular/common/http/testing';
import {provideNoopAnimations} from '@angular/platform-browser/animations';

import {BeringerComponent} from './beringer';
import {Beringer} from '../models/beringer.model';

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

function setup() {
  TestBed.configureTestingModule({
    imports: [BeringerComponent],
    providers: [provideHttpClient(), provideHttpClientTesting(), provideNoopAnimations()],
  });
  const fixture: ComponentFixture<BeringerComponent> = TestBed.createComponent(BeringerComponent);
  httpMock = TestBed.inject(HttpTestingController);
  return {fixture, component: fixture.componentInstance};
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
});
