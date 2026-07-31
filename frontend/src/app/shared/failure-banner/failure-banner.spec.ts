import {Component} from '@angular/core';
import {ComponentFixture, TestBed, fakeAsync, tick} from '@angular/core/testing';
import {HttpErrorResponse, provideHttpClient} from '@angular/common/http';
import {HttpTestingController, provideHttpClientTesting} from '@angular/common/http/testing';
import {MatDialog, MatDialogRef} from '@angular/material/dialog';
import {provideRouter, Router} from '@angular/router';
import {provideNoopAnimations} from '@angular/platform-browser/animations';
import {of} from 'rxjs';

import {FailureBannerComponent} from './failure-banner';
import {FeedbackDialogComponent} from '../../feedback/feedback-dialog/feedback-dialog';
import {AppIconErrorDirective} from '../app-icons';
import {renderedGlyph, seamGlyph} from '../app-icons.testing';
import {AppFailure, classifyFailure, failureFromSyncError} from '../../core/errors/app-failure';
import {unsavedChangesGuard} from '../../core/guards/unsaved-changes.guard';
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

  // „Fehler melden" (#449, ADR 0037): der eine Ausweg der Klasse *Unbekannt* —
  // und der eines 5xx, bei dem sich der Server verschluckt hat.
  it('bietet bei „Unbekannt" das Melden an und öffnet den bestehenden Feedback-Dialog', () => {
    const el = render(rejection(418, {detail: 'Ich bin eine Teekanne.'}));
    const dialog = fixture.debugElement.injector.get(MatDialog);
    const open = spyOn(dialog, 'open').and.returnValue({
      afterClosed: () => of(false),
    } as MatDialogRef<unknown>);

    const melden = button(el, 'Fehler melden');
    expect(melden).toBeDefined();
    melden!.click();

    expect(open).toHaveBeenCalled();
    // Kein zweiter Dialog: derselbe, den auch die Navigationsleiste öffnet.
    expect(open.calls.mostRecent().args[0]).toBe(FeedbackDialogComponent);
    const prefill = (open.calls.mostRecent().args[1] as {data: {prefill: string}}).data.prefill;
    expect(prefill).toContain('Endpunkt: https://app.birddoc.eu/api/birds/data-entries/');
    expect(prefill).toContain('Status: 418');
    expect(prefill).toContain('Bildschirm: /');
    expect(prefill).toContain('Version: aktuell');
    expect(prefill).not.toContain('undefined');
  });

  it('bietet bei einem 5xx beides an — noch einmal versuchen und melden', () => {
    const el = render(rejection(503, {detail: 'Wartung'}));

    expect(button(el, 'Erneut versuchen')).toBeDefined();
    expect(button(el, 'Fehler melden')).toBeDefined();
  });

  it('bietet das Melden nicht an, wo das Mitglied selbst weiterkommt', () => {
    // *Korrigieren*, *Neu anmelden*, *Freigeben lassen*, *App aktualisieren*
    // und *Erneut versuchen* ohne 5xx: dort wären Berichte Nicht-Bugs.
    const eigenhaendig = [
      rejection(400, {ring_number: RING_ALREADY_FIRST_CAUGHT}),
      rejection(401, {
        detail: 'Anmeldedaten fehlen.',
        errors: [{field: null, code: 'not_authenticated', detail: 'Anmeldedaten fehlen.'}],
      }),
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
      rejection(404, {detail: 'Nicht gefunden.'}),
      rejection(0, null),
      failureFromSyncError(RING_ALREADY_FIRST_CAUGHT),
    ];

    for (const failure of eigenhaendig) {
      expect(button(render(failure), 'Fehler melden'))
        .withContext(failure.klasse)
        .toBeUndefined();
    }
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
 * Die Abhilfen bei bereits vergebener Ringnummer (#444, ADR 0037/0038).
 *
 * Das Banner sagt schon, dass die Nummer vergeben ist. Die Frage, die der
 * Beringer mit dem Vogel in der Hand tatsächlich stellt, beantwortet erst der
 * **kollidierende Erstfang**: ist das derselbe Vogel — also in Wahrheit ein
 * Wiederfang — oder hat vorige Woche jemand eine Nummer vertippt?
 *
 * Drei Abhilfen, und **keine** von ihnen speichert. Ein Knopf darf den
 * Ringstatus setzen oder eine freie Nummer eintragen; drücken muss der Beringer
 * selbst, weil „Als Wiederfang" die wissenschaftliche Aussage des Datensatzes
 * ändert und das sichtbar, widerruflich und bewusst bleiben muss.
 */
describe('FailureBannerComponent — die Abhilfen bei bereits vergebener Ringnummer (#444)', () => {
  let fixture: ComponentFixture<FailureBannerComponent>;
  let httpMock: HttpTestingController;

  /** Der Rivale aus `test_the_collision_names_the_erstfang_that_holds_the_number`. */
  const RIVAL = {
    id: '6f1a6a1e-0f0e-4f5a-9a3b-2f9d1c7e5b40',
    date_time: '2026-07-28T08:15:00+02:00',
    species: 'Teichrohrsänger',
    staff: 'FRE',
  };

  /**
   * Datum und Uhrzeit des Rivalen, wie sie in der Zeitzone dieses Rechners
   * fallen — unabhängig vom Formatierungspfad des Bauteils ausgerechnet, damit
   * die Zusicherung nicht bloß nachrechnet, was das Bauteil ohnehin tut.
   */
  const zeitpunkt = new Date(RIVAL.date_time);
  const zweistellig = (zahl: number) => `${zahl}`.padStart(2, '0');
  const DATUM = `${zweistellig(zeitpunkt.getDate())}.${zweistellig(
    zeitpunkt.getMonth() + 1,
  )}.${zeitpunkt.getFullYear()}`;
  const UHRZEIT = `${zweistellig(zeitpunkt.getHours())}:${zweistellig(zeitpunkt.getMinutes())}`;

  /** Die Zurückweisung mit ihrem Kontext — der Körper, den der Server schickt. */
  const kollision = (context: unknown = {rival: RIVAL}) =>
    rejection(400, {
      ring_number: RING_ALREADY_FIRST_CAUGHT,
      errors: [
        {
          field: 'ring_number',
          code: 'ring_already_first_caught',
          detail: RING_ALREADY_FIRST_CAUGHT,
          context,
        },
      ],
    });

  function render(failure: AppFailure, keineFreieNummer = false): HTMLElement {
    fixture = TestBed.createComponent(FailureBannerComponent);
    fixture.componentRef.setInput('failure', failure);
    fixture.componentRef.setInput('keineFreieNummer', keineFreieNummer);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const knopf = (el: HTMLElement, testid: string): HTMLButtonElement | null =>
    el.querySelector(`[data-testid="${testid}"]`);

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

  it('nennt den kollidierenden Erstfang mit Datum, Uhrzeit, Art und Beringer-Kürzel', () => {
    const el = render(kollision());

    const rivale = el.querySelector('[data-testid="failure-rival"]')!;
    expect(rivale.textContent).toContain(DATUM);
    expect(rivale.textContent).toContain(UHRZEIT);
    expect(rivale.textContent).toContain('Teichrohrsänger');
    expect(rivale.textContent).toContain('FRE');
    // Nicht die rohe Zeichenkette der Leitung.
    expect(rivale.textContent).not.toContain('2026-07-28T08:15');
    // Der Grund des Servers steht weiterhin da.
    expect(el.textContent).toContain(RING_ALREADY_FIRST_CAUGHT);
  });

  it('öffnet den kollidierenden Erstfang aus dem Banner', () => {
    const el = render(kollision());
    const navigate = spyOn(TestBed.inject(Router), 'navigate');

    knopf(el, 'failure-rival-oeffnen')!.click();

    // Die gewöhnliche Navigation zu einem Fang — und damit dieselben
    // Verwerfen-Regeln wie überall sonst (#407): der `unsavedChangesGuard`
    // hängt an der Route, nicht an diesem Knopf. Keine Ausnahme, die den
    // laufenden Eintrag still fallen ließe.
    expect(navigate).toHaveBeenCalledWith(['/data-entry', RIVAL.id]);
  });

  it('meldet „Als Wiederfang erfassen" nach oben und speichert nichts', () => {
    const el = render(kollision());
    let gemeldet = 0;
    fixture.componentInstance.alsWiederfang.subscribe(() => (gemeldet += 1));

    knopf(el, 'failure-wiederfang')!.click();

    expect(gemeldet).toBe(1);
    // Der Knopf füllt das Formular. Er schickt nichts — nicht einmal eine
    // Anfrage, geschweige denn eine Speicherung.
    httpMock.expectNone(() => true);
  });

  it('meldet „Nächste freie Nummer übernehmen" nach oben und speichert nichts', () => {
    const el = render(kollision());
    let gemeldet = 0;
    fixture.componentInstance.freieNummer.subscribe(() => (gemeldet += 1));

    knopf(el, 'failure-freie-nummer')!.click();

    expect(gemeldet).toBe(1);
    // Die Nummer holt das Formular, das die Ringgröße kennt — dieses Bauteil
    // schickt auch hier nichts.
    httpMock.expectNone(() => true);
  });

  it('sagt es, wenn keine freie Nummer zu bekommen ist', () => {
    // Ehrlich statt still: ein Knopf, der wortlos nichts tut, wäre schlimmer
    // als seine Abwesenheit.
    const el = render(kollision(), true);

    expect(knopf(el, 'failure-freie-nummer')).toBeNull();
    expect(el.querySelector('[data-testid="failure-keine-freie-nummer"]')).not.toBeNull();
    // Die beiden übrigen Abhilfen stehen weiter da.
    expect(knopf(el, 'failure-wiederfang')).not.toBeNull();
    expect(knopf(el, 'failure-rival-oeffnen')).not.toBeNull();
  });

  it('degradiert ohne Kontext auf den Satz allein', () => {
    // Ein älteres Backend, ein Bundle mitten in der Auslieferung: der Code ist
    // da, der Rivale nicht. Dieselbe Regel wie bei einem unbekannten Code —
    // der Satz steht, es gibt nichts anzubieten, und nichts bricht.
    const el = render(kollision(null));

    const banner = el.querySelector('[data-testid="failure-banner"]')!;
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.textContent).toContain(RING_ALREADY_FIRST_CAUGHT);
    expect(banner.textContent).toContain('Bitte korrigieren und erneut speichern.');
    expect(el.querySelector('[data-testid="failure-rival"]')).toBeNull();
    expect(el.querySelectorAll('button').length).toBe(0);
  });

  it('bietet die Abhilfen bei einem anderen Code nicht an', () => {
    // Der Code ist die Naht (ADR 0038): eine andere Zurückweisung desselben
    // Feldes bekommt „Als Wiederfang erfassen" nicht.
    const el = render(
      rejection(400, {
        ring_number: 'Die Ringnummer darf nur Ziffern enthalten.',
        errors: [
          {
            field: 'ring_number',
            code: 'invalid',
            detail: 'Die Ringnummer darf nur Ziffern enthalten.',
          },
        ],
      }),
    );

    expect(el.querySelectorAll('button').length).toBe(0);
    expect(el.querySelector('[data-testid="failure-rival"]')).toBeNull();
  });
});

/**
 * Den Rivalen öffnen, während schon ein Fang offen steht (#444, #407).
 *
 * Ein zurückgewiesener **eingereihter** Eintrag (#445) trägt dasselbe Banner mit
 * demselben Rivalen — und er steht dabei auf `/data-entry/:id`. Für den Router
 * ist das Ziel dann dieselbe Route mit einer anderen Id: er verwendet das
 * Bauteil wieder, lädt nichts neu und lässt den `unsavedChangesGuard` gar nicht
 * erst laufen. Geprüft wird hier deshalb am **Ergebnis** — wo die App danach
 * steht —, nicht daran, welcher Aufruf dorthin geführt hat.
 */
describe('FailureBannerComponent — den Rivalen öffnen, während ein Fang offen steht (#444)', () => {
  const RIVAL_ID = '6f1a6a1e-0f0e-4f5a-9a3b-2f9d1c7e5b40';
  const unsavedChanges = {confirmDiscard: jasmine.createSpy('confirmDiscard')};

  /** Die Erfassungsmaske, wie sie unter beiden Routen hängt (`app.routes.ts`). */
  @Component({selector: 'app-capture-stub', standalone: true, template: '<p>Erfassung</p>'})
  class CaptureStubComponent {}

  const kollision = () =>
    rejection(400, {
      ring_number: RING_ALREADY_FIRST_CAUGHT,
      errors: [
        {
          field: 'ring_number',
          code: 'ring_already_first_caught',
          detail: RING_ALREADY_FIRST_CAUGHT,
          context: {
            rival: {
              id: RIVAL_ID,
              date_time: '2026-07-28T08:15:00+02:00',
              species: 'Teichrohrsänger',
              staff: 'FRE',
            },
          },
        },
      ],
    });

  beforeEach(async () => {
    unsavedChanges.confirmDiscard.calls.reset();
    unsavedChanges.confirmDiscard.and.returnValue(of(true));
    await TestBed.configureTestingModule({
      imports: [FailureBannerComponent],
      providers: [
        provideRouter([
          // Wortgleich aus `app.routes.ts`, nur ohne `authGuard`.
          {
            path: 'data-entry',
            component: CaptureStubComponent,
            canDeactivate: [unsavedChangesGuard],
          },
          {
            path: 'data-entry/:id',
            component: CaptureStubComponent,
            canDeactivate: [unsavedChangesGuard],
          },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        {provide: UnsavedChangesService, useValue: unsavedChanges},
      ],
    }).compileComponents();
  });

  async function bannerUeberEinemOffenenFang(): Promise<HTMLButtonElement> {
    const router = TestBed.inject(Router);
    await router.navigateByUrl(`/data-entry/eingereiht-1`);
    const fixture = TestBed.createComponent(FailureBannerComponent);
    fixture.componentRef.setInput('failure', kollision());
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="failure-rival-oeffnen"]',
    ) as HTMLButtonElement;
  }

  it('landet wirklich beim Rivalen', async () => {
    const oeffnen = await bannerUeberEinemOffenenFang();

    oeffnen.click();
    // Zwei Navigationen hintereinander: erst das Verlassen, dann das Öffnen.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(TestBed.inject(Router).url).toBe(`/data-entry/${RIVAL_ID}`);
    expect(unsavedChanges.confirmDiscard).withContext('der Wächter wurde gefragt').toHaveBeenCalled();
  });

  it('bleibt stehen, wo der Wächter das Verwerfen ablehnt', async () => {
    unsavedChanges.confirmDiscard.and.returnValue(of(false));
    const oeffnen = await bannerUeberEinemOffenenFang();

    oeffnen.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // „Weiter bearbeiten": der Eintrag, der offen stand, steht weiter offen.
    expect(TestBed.inject(Router).url).toBe('/data-entry/eingereiht-1');
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

  /**
   * Der Antwortkörper aus `test_admin_only_403_is_unchanged_and_gains_a_field_less_entry`
   * — Code und Satz byte-gleich zu dem, was der Server heute schickt:
   * `admin_only` (der Domänencode aus #441), nicht DRFs generisches
   * `permission_denied`, das seit der Disambiguierung des 403 kein Endpunkt mehr
   * ausstellt.
   */
  const rechteverweigerung = () =>
    rejection(403, {
      detail: ADMIN_ONLY,
      errors: [{field: null, code: 'admin_only', detail: ADMIN_ONLY}],
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

  it('malt eine verspätete Antwort nicht auf das Banner einer anderen Klasse', () => {
    // Dasselbe Bauteil, ein zweiter Fehlschlag: `data-entry-form` ruft
    // `showFailure()` aus fünf Botengängen, und nur das Speichern leert das
    // Banner vorher — es geht also von einem Fehlschlag direkt in den nächsten,
    // ohne dass die Komponente dazwischen stirbt.
    const el = render(rechteverweigerung());
    const laufend = adminRead();

    fixture.componentRef.setInput('failure', rejection(503, {detail: 'Wartung'}));
    fixture.detectChanges();

    // Die Antwort auf die alte Frage kommt erst jetzt. Sie gehört einer Klasse,
    // die nicht mehr da ist — und hat auf diesem Banner nichts zu suchen.
    laufend.flush({
      count: 1,
      next: null,
      previous: null,
      results: [{name: 'Alice Auer', handle: 'ALC'}],
    });
    fixture.detectChanges();

    expect(bannerText(el)).not.toContain('Alice Auer');
    expect(el.querySelector('[data-testid="failure-admins"]')).toBeNull();
    // Und der Ausweg dieser Klasse steht noch da, statt von einer Person
    // verdrängt zu sein, die nichts freizugeben hat.
    expect(bannerText(el)).toContain('Bitte versuche es noch einmal.');
    expect(
      Array.from(el.querySelectorAll('button')).some((b) =>
        b.textContent?.includes('Erneut versuchen'),
      ),
    ).toBeTrue();
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
