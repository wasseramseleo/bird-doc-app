import {Location} from '@angular/common';
import {provideLocationMocks} from '@angular/common/testing';
import {Component} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {NavigationEnd, Router, provideRouter} from '@angular/router';
import {of} from 'rxjs';

import {FangNavigation} from './fang-navigation';
import {unsavedChangesGuard} from '../../core/guards/unsaved-changes.guard';
import {UnsavedChangesService} from '../../service/unsaved-changes.service';

/**
 * „Navigiere zu diesem Fang, und wecke dabei den Wächter" (#492) — die eine
 * Einheit, die den Zwischenschritt kennt.
 *
 * Geprüft wird am **Ergebnis**: wo die App danach steht, ob der Wächter gefragt
 * wurde und was in der Verlaufsgeschichte des Browsers steht — nicht daran,
 * welcher Aufruf dorthin geführt hat. Der Zwischenschritt ist genau deshalb da,
 * weil `/data-entry/:a` → `/data-entry/:b` für den Router **dieselbe** Route mit
 * einer anderen Id ist: er verwendet das Bauteil wieder und lässt den
 * `unsavedChangesGuard` (#407, ADR 0032) gar nicht erst laufen.
 */
describe('FangNavigation', () => {
  const ZIEL = '6f1a6a1e-0f0e-4f5a-9a3b-2f9d1c7e5b40';
  const OFFEN = 'eingereiht-1';

  const unsavedChanges = {confirmDiscard: jasmine.createSpy('confirmDiscard')};

  /** Die Erfassungsmaske, wie sie unter beiden Routen hängt (`app.routes.ts`). */
  @Component({selector: 'app-capture-stub', standalone: true, template: '<p>Erfassung</p>'})
  class CaptureStubComponent {}

  /** Irgendein Bildschirm, auf dem **kein** Fang offen steht („Letzte Fänge"). */
  @Component({selector: 'app-list-stub', standalone: true, template: '<p>Letzte Fänge</p>'})
  class ListStubComponent {}

  let router: Router;
  let navigation: FangNavigation;

  beforeEach(() => {
    unsavedChanges.confirmDiscard.calls.reset();
    unsavedChanges.confirmDiscard.and.returnValue(of(true));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {path: 'data-entries', component: ListStubComponent},
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
        provideLocationMocks(),
        {provide: UnsavedChangesService, useValue: unsavedChanges},
      ],
    });
    router = TestBed.inject(Router);
    navigation = TestBed.inject(FangNavigation);
  });

  /** Wo die App unterwegs war, in der Reihenfolge des Ankommens. */
  function spur(): string[] {
    const besucht: string[] = [];
    router.events.subscribe((ereignis) => {
      if (ereignis instanceof NavigationEnd) {
        besucht.push(ereignis.urlAfterRedirects);
      }
    });
    return besucht;
  }

  it('navigiert direkt zum Fang, solange keiner offen steht', async () => {
    await router.navigateByUrl('/data-entries');
    const besucht = spur();

    await expectAsync(navigation.zumFang(ZIEL)).toBeResolvedTo(true);

    // Kein Zwischenschritt: die leere Erfassungsmaske wird nicht einmal
    // betreten. Sonst stellte der Wächter beim Verlassen dieser Maske eine
    // Frage über eine Erfassung, die es gar nicht gibt — und eine Ablehnung
    // ließe die Beringer:in auf einem leeren Formular stehen statt auf ihrem
    // Fang.
    expect(besucht).toEqual([`/data-entry/${ZIEL}`]);
    expect(router.url).toBe(`/data-entry/${ZIEL}`);
    expect(unsavedChanges.confirmDiscard).not.toHaveBeenCalled();
  });

  it('geht über den Zwischenschritt und weckt damit den Wächter, wenn schon ein Fang offen steht', async () => {
    await router.navigateByUrl(`/data-entry/${OFFEN}`);
    const besucht = spur();

    await expectAsync(navigation.zumFang(ZIEL)).toBeResolvedTo(true);

    expect(besucht).toEqual(['/data-entry', `/data-entry/${ZIEL}`]);
    expect(router.url).toBe(`/data-entry/${ZIEL}`);
    expect(unsavedChanges.confirmDiscard)
      .withContext('der Wächter wurde gefragt')
      .toHaveBeenCalled();
  });

  it('öffnet den Zielfang nicht, wo der Wächter ablehnt', async () => {
    await router.navigateByUrl(`/data-entry/${OFFEN}`);
    unsavedChanges.confirmDiscard.and.returnValue(of(false));

    await expectAsync(navigation.zumFang(ZIEL)).toBeResolvedTo(false);

    // „Weiter bearbeiten": der Fang, der offen stand, steht weiter offen.
    expect(router.url).toBe(`/data-entry/${OFFEN}`);
  });

  it('trägt den Zwischenschritt nicht in die Verlaufsgeschichte des Browsers ein', async () => {
    const location = TestBed.inject(Location);
    await router.navigateByUrl(`/data-entry/${OFFEN}`);

    await navigation.zumFang(ZIEL);
    expect(location.path()).toBe(`/data-entry/${ZIEL}`);

    // Ein Schritt zurück führt dorthin, wo die Beringer:in herkam — nicht auf
    // die leere Erfassungsmaske, durch die der Weg lief.
    location.back();
    expect(location.path()).toBe(`/data-entry/${OFFEN}`);
  });
});
