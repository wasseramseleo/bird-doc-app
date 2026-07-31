import {ComponentFixture, TestBed, fakeAsync, tick} from '@angular/core/testing';
import {HttpErrorResponse, provideHttpClient} from '@angular/common/http';
import {provideHttpClientTesting} from '@angular/common/http/testing';
import {MatDialog, MatDialogRef} from '@angular/material/dialog';
import {provideRouter, Router} from '@angular/router';
import {provideNoopAnimations} from '@angular/platform-browser/animations';
import {of} from 'rxjs';

import {FailureBannerComponent} from './failure-banner';
import {FeedbackDialogComponent} from '../../feedback/feedback-dialog/feedback-dialog';
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
    // Die namentlich genannten Admins sind #450; hier steht der Ausweg als Satz.
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
