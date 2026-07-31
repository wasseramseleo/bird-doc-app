import {ComponentFixture, TestBed, fakeAsync, tick} from '@angular/core/testing';
import {HttpErrorResponse, provideHttpClient} from '@angular/common/http';
import {HttpTestingController, provideHttpClientTesting} from '@angular/common/http/testing';
import {provideRouter, Router} from '@angular/router';
import {provideNoopAnimations} from '@angular/platform-browser/animations';
import {of} from 'rxjs';

import {FailureBannerComponent} from './failure-banner';
import {AppIconErrorDirective} from '../app-icons';
import {renderedGlyph, seamGlyph} from '../app-icons.testing';
import {AppFailure, classifyFailure, failureFromSyncError} from '../../core/errors/app-failure';
import {AppUpdateService} from '../../service/app-update.service';
import {AuthService} from '../../service/auth.service';
import {UnsavedChangesService} from '../../service/unsaved-changes.service';

const RING_ALREADY_FIRST_CAUGHT =
  'Für diese Ringnummer besteht in dieser Organisation bereits ein Erstfang.';

function rejection(status: number, body: unknown): AppFailure {
  return classifyFailure(
    new HttpErrorResponse({
      status,
      statusText: 'error',
      url: 'https://app.birddoc.eu/api/birds/data-entries/',
      error: body,
    }),
  );
}

describe('FailureBannerComponent', () => {
  let fixture: ComponentFixture<FailureBannerComponent>;

  function render(failure: AppFailure, titel?: string): HTMLElement {
    fixture = TestBed.createComponent(FailureBannerComponent);
    fixture.componentRef.setInput('failure', failure);
    if (titel !== undefined) {
      fixture.componentRef.setInput('titel', titel);
    }
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const button = (el: HTMLElement, label: string): HTMLButtonElement | undefined =>
    Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(label));

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FailureBannerComponent],
      providers: [
        provideRouter([{path: 'login', children: []}]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
      ],
    }).compileComponents();
  });

  it('nennt den Titel der Klasse, den Grund des Servers und den Ausweg', () => {
    const el = render(
      rejection(400, {
        ring_number: RING_ALREADY_FIRST_CAUGHT,
        errors: [{field: 'ring_number', code: 'invalid', detail: RING_ALREADY_FIRST_CAUGHT}],
      }),
    );

    const banner = el.querySelector('[data-testid="failure-banner"]')!;
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.textContent).toContain('Speichern abgelehnt');
    expect(banner.textContent).toContain(RING_ALREADY_FIRST_CAUGHT);
    expect(banner.textContent).toContain('Bitte korrigieren und erneut speichern.');
    // Die Transportzeichenkette, mit der dieses PRD anfing, steht nirgends.
    expect(banner.textContent).not.toContain('Http failure response');
  });

  it('zeichnet das App-Icon des kaputten Zustands, nicht eine benannte Glyphe', () => {
    const el = render(rejection(400, {detail: 'abgelehnt'}));

    expect(renderedGlyph(el.querySelector('mat-icon'))).toBeTruthy();
    expect(seamGlyph(fixture, AppIconErrorDirective)).toBeTruthy();
  });

  it('nimmt den Titel des Moments entgegen — dasselbe Bauteil online wie beim Replay', () => {
    const el = render(
      failureFromSyncError(RING_ALREADY_FIRST_CAUGHT),
      'Synchronisierung abgelehnt',
    );

    const banner = el.querySelector('[data-testid="failure-banner"]')!;
    expect(banner.textContent).toContain('Synchronisierung abgelehnt');
    expect(banner.textContent).toContain(RING_ALREADY_FIRST_CAUGHT);
    expect(banner.textContent).toContain('Bitte korrigieren und erneut speichern.');
  });

  it('bietet beim Korrigieren keinen Knopf an — das Formular ist der Ausweg', () => {
    const el = render(
      rejection(400, {
        ring_number: RING_ALREADY_FIRST_CAUGHT,
        // Ein Code, den dieser Client (noch) nicht kennt: er bekommt seinen
        // Satz und **keine** Abhilfe (ADR 0038) — „Als Wiederfang erfassen"
        // gehört #444, nicht einem geratenen Textvergleich.
        errors: [
          {
            field: 'ring_number',
            code: 'ring_already_first_caught',
            detail: RING_ALREADY_FIRST_CAUGHT,
          },
        ],
      }),
    );

    expect(el.querySelectorAll('button').length).toBe(0);
  });

  it('bietet bei „Neu anmelden" die Anmeldung an und führt hin', () => {
    const el = render(
      rejection(403, {
        detail: 'Anmeldedaten fehlen.',
        errors: [{field: null, code: 'not_authenticated', detail: 'Anmeldedaten fehlen.'}],
      }),
    );
    const router = TestBed.inject(Router);
    const navigate = spyOn(router, 'navigate');

    const anmelden = button(el, 'Anmelden');
    expect(anmelden).toBeDefined();
    anmelden!.click();

    expect(navigate).toHaveBeenCalledWith(['/login'], jasmine.anything());
  });

  // #447 (ADR 0039): der `authInterceptor` hält bei einem dauerhaften
  // Schreibvorgang seine 401-Arbeit zurück, damit der Fang noch unter seinem
  // Konto in die Outbox kommt. Die Sitzung steht dann noch — und der
  // `guestGuard` würde das Mitglied von `/login` postwendend zurückwerfen. Der
  // Knopf beendet sie deshalb selbst: er ist die Aufforderung, angenommen.
  it('beendet die Sitzung, bevor es zur Anmeldung führt', () => {
    const auth = TestBed.inject(AuthService);
    auth.currentUser.set({
      username: 'fre',
      handle: 'FRE',
      isStaff: false,
      rolle: 'mitglied',
      organization: null,
    });
    const el = render(
      rejection(401, {
        detail: 'Anmeldedaten fehlen.',
        errors: [{field: null, code: 'not_authenticated', detail: 'Anmeldedaten fehlen.'}],
      }),
    );
    spyOn(TestBed.inject(Router), 'navigate');

    button(el, 'Anmelden')!.click();

    expect(auth.currentUser()).toBeNull();
  });

  it('bietet bei „App aktualisieren" die Aktualisierung an und stößt sie an', fakeAsync(() => {
    const appUpdate = TestBed.inject(AppUpdateService);
    const checkForUpdate = spyOn(appUpdate, 'checkForUpdate').and.resolveTo();
    const adopt = spyOn(appUpdate, 'adopt').and.resolveTo();
    // Eine wartende Version, sonst gibt es nichts zu übernehmen (ADR 0032).
    spyOn(appUpdate, 'versionWaiting').and.returnValue(true);
    spyOn(TestBed.inject(UnsavedChangesService), 'confirmDiscard').and.returnValue(of(true));

    const el = render(rejection(404, {detail: 'Nicht gefunden.'}));

    const aktualisieren = button(el, 'Jetzt aktualisieren');
    expect(aktualisieren).toBeDefined();
    aktualisieren!.click();
    tick();

    expect(checkForUpdate).toHaveBeenCalled();
    expect(adopt).toHaveBeenCalled();
  }));

  it('lädt bei „App aktualisieren" nichts neu, wenn keine Version wartet', fakeAsync(() => {
    const appUpdate = TestBed.inject(AppUpdateService);
    spyOn(appUpdate, 'checkForUpdate').and.resolveTo();
    const adopt = spyOn(appUpdate, 'adopt').and.resolveTo();
    spyOn(appUpdate, 'versionWaiting').and.returnValue(false);
    const confirmDiscard = spyOn(
      TestBed.inject(UnsavedChangesService),
      'confirmDiscard',
    ).and.returnValue(of(true));

    const el = render(rejection(404, {detail: 'Nicht gefunden.'}));
    button(el, 'Jetzt aktualisieren')!.click();
    tick();

    // Weder nach dem Verwerfen gefragt noch neu geladen: es gäbe nichts zu
    // übernehmen, und ein Reload mitten in einer Erfassung ist Datenverlust.
    expect(confirmDiscard).not.toHaveBeenCalled();
    expect(adopt).not.toHaveBeenCalled();
  }));

  it('bietet bei „Erneut versuchen" den erneuten Versuch an und meldet ihn nach oben', () => {
    const el = render(rejection(503, {detail: 'Wartung'}));
    let retries = 0;
    fixture.componentInstance.retry.subscribe(() => (retries += 1));

    const erneut = button(el, 'Erneut versuchen');
    expect(erneut).toBeDefined();
    erneut!.click();

    expect(retries).toBe(1);
  });

  it('bietet bei „Freigeben lassen" keinen der drei Knöpfe an', () => {
    // Der Ausweg ist eine Person, kein Knopf — siehe die Scheibe darunter.
    const el = render(
      rejection(403, {
        detail: 'Diese Aktion ist Administrator:innen der Organisation vorbehalten.',
        errors: [
          {
            field: null,
            code: 'permission_denied',
            detail: 'Diese Aktion ist Administrator:innen der Organisation vorbehalten.',
          },
        ],
      }),
    );

    expect(button(el, 'Anmelden')).toBeUndefined();
    expect(button(el, 'Jetzt aktualisieren')).toBeUndefined();
    expect(button(el, 'Erneut versuchen')).toBeUndefined();
    expect(el.textContent).toContain('Administrator');
  });
});

/**
 * „Freigeben lassen" nennt eine Person (#450, ADR 0037).
 *
 * „Wende dich an eine:n Admin" ist in einer Organisation mit zwanzig Mitgliedern
 * ein Achselzucken. Sobald die Klasse *Freigeben lassen* feststeht, liest das
 * Banner die Admins der **eigenen** Organisation (`GET /birds/org-admins/`,
 * ADR 0005) und nennt sie beim Namen.
 *
 * Die Kehrseite trägt genauso viel Gewicht: wo die Liste **nicht** zu lesen ist —
 * ohne Netz, oder weil der Lesevorgang selbst scheitert —, bleibt es beim blanken
 * Grund. Ein leeres „frag: " oder ein zweiter Fehler über den ersten wäre das
 * schlechteste erreichbare Ergebnis.
 */
describe('FailureBannerComponent — die Admins beim Namen (#450)', () => {
  let fixture: ComponentFixture<FailureBannerComponent>;
  let httpMock: HttpTestingController;

  const ADMIN_ONLY =
    'Diese Aktion ist Administrator:innen der Organisation vorbehalten. ' +
    'Bitte wende dich an eine Administratorin oder einen Administrator.';
  /** Der Ausweg-Satz der Klasse, solange keine Person genannt werden kann. */
  const NUR_DIE_ROLLE =
    'Das darf nur eine Administratorin oder ein Administrator deiner Organisation.';

  /** test_admin_only_403_is_unchanged_and_gains_a_field_less_entry. */
  const rechteverweigerung = () =>
    rejection(403, {
      detail: ADMIN_ONLY,
      errors: [{field: null, code: 'permission_denied', detail: ADMIN_ONLY}],
    });

  function render(failure: AppFailure): HTMLElement {
    fixture = TestBed.createComponent(FailureBannerComponent);
    fixture.componentRef.setInput('failure', failure);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const adminRead = () =>
    httpMock.expectOne((r) => r.method === 'GET' && r.url.endsWith('/birds/org-admins/'));

  const bannerText = (el: HTMLElement) =>
    el.querySelector('[data-testid="failure-banner"]')!.textContent!;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FailureBannerComponent],
      providers: [
        provideRouter([{path: 'login', children: []}]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
  });

  it('nennt die Admins der eigenen Organisation mit Namen und Kürzel', () => {
    const el = render(rechteverweigerung());

    adminRead().flush({
      count: 2,
      next: null,
      previous: null,
      results: [
        {name: 'Alice Auer', handle: 'ALC'},
        {name: 'Mara Berg', handle: 'MAR'},
      ],
    });
    fixture.detectChanges();

    expect(bannerText(el)).toContain('Alice Auer (ALC)');
    expect(bannerText(el)).toContain('Mara Berg (MAR)');
    // Der Grund des Servers bleibt stehen; ersetzt wird nur das Achselzucken.
    expect(bannerText(el)).toContain(ADMIN_ONLY);
    expect(bannerText(el)).not.toContain(NUR_DIE_ROLLE);
  });

  it('lässt einen Admin weg, den es weder benennen noch abkürzen kann', () => {
    // Ein Konto ohne Namen und ohne Beringer-Eintrag: der Server erfindet nichts
    // (test_an_admin_without_a_beringer_entry_carries_no_kuerzel), und ein Name
    // aus dem Nichts steht auch hier nicht.
    const el = render(rechteverweigerung());

    adminRead().flush({
      count: 3,
      next: null,
      previous: null,
      results: [
        {name: 'Alice Auer', handle: 'ALC'},
        {name: 'Gerda Ohnebogen', handle: null},
        {name: '', handle: null},
      ],
    });
    fixture.detectChanges();

    expect(bannerText(el)).toContain('Alice Auer (ALC)');
    expect(bannerText(el)).toContain('Gerda Ohnebogen');
    expect(bannerText(el)).not.toContain('()');
  });

  it('degradiert auf den blanken Grund, wenn die Admin-Liste nicht zu lesen ist', () => {
    // Ohne Netz: Status 0. Der Fehlschlag über dem Fehlschlag bleibt unsichtbar —
    // das Banner sagt weiter, was los ist, und nennt eben niemanden.
    const el = render(rechteverweigerung());

    adminRead().error(new ProgressEvent('error'), {status: 0, statusText: 'offline'});
    fixture.detectChanges();

    expect(bannerText(el)).toContain(ADMIN_ONLY);
    expect(bannerText(el)).toContain(NUR_DIE_ROLLE);
    expect(fixture.nativeElement.querySelector('[data-testid="failure-admins"]')).toBeNull();
    // Kein zweites Banner, kein zweiter Fehler.
    expect(el.querySelectorAll('[data-testid="failure-banner"]').length).toBe(1);
  });

  it('degradiert genauso, wenn die Organisation keinen nennbaren Admin hergibt', () => {
    // Ein Konto ohne aktive Organisation bekommt ein **leeres** Ergebnis, keinen
    // 403 (test_account_without_active_organisation_gets_an_empty_result_not_a_403).
    const el = render(rechteverweigerung());

    adminRead().flush({count: 0, next: null, previous: null, results: []});
    fixture.detectChanges();

    expect(bannerText(el)).toContain(NUR_DIE_ROLLE);
    expect(fixture.nativeElement.querySelector('[data-testid="failure-admins"]')).toBeNull();
  });

  it('schickt eine CSRF-Ablehnung zu niemandem und liest die Liste gar nicht erst', () => {
    // test_csrf_ablehnung_carries_a_different_code_than_rechteverweigerung:
    // derselbe 403, der gegensätzliche Ausweg. Ein Mitglied deswegen zu einer
    // Kollegin zu schicken, ist genau der Fehlgriff, den #441 ausgeräumt hat.
    const el = render(
      rejection(403, {
        detail: 'CSRF Failed: CSRF cookie not set.',
        errors: [
          {field: null, code: 'csrf_failed', detail: 'CSRF Failed: CSRF cookie not set.'},
        ],
      }),
    );

    httpMock.expectNone((r) => r.url.includes('org-admins'));
    expect(
      Array.from(el.querySelectorAll('button')).some((b) =>
        b.textContent?.includes('Erneut versuchen'),
      ),
    ).toBeTrue();
    expect(el.querySelector('[data-testid="failure-admins"]')).toBeNull();
    expect(bannerText(el)).not.toContain('Administrator');
  });

  it('liest die Liste nur, wo eine Person überhaupt etwas ausrichten kann', () => {
    // In den übrigen fünf Klassen hat kein Admin etwas freizugeben — dort wird
    // auch nicht gelesen, statt eine Antwort einzuholen und zu verwerfen.
    for (const anderswo of [
      rejection(400, {detail: 'Speichern abgelehnt.'}),
      rejection(503, {detail: 'Wartung'}),
    ]) {
      const el = render(anderswo);

      httpMock.expectNone((r) => r.url.includes('org-admins'));
      expect(el.querySelector('[data-testid="failure-admins"]')).toBeNull();
    }
  });
});
