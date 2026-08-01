import {registerLocaleData} from '@angular/common';
import localeDeAt from '@angular/common/locales/de-AT';
import {provideLocationMocks} from '@angular/common/testing';
import {ApplicationRef, Component, LOCALE_ID} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {OverlayContainer} from '@angular/cdk/overlay';
import {MatDialog} from '@angular/material/dialog';
import {provideNoopAnimations} from '@angular/platform-browser/animations';
import {Router, provideRouter} from '@angular/router';
import {of} from 'rxjs';

import {DataEntryDetailDialogComponent} from './data-entry-detail-dialog';
import {DetailDialogOpener} from './detail-dialog-opener';
import {ConnectivityService} from '../../core/offline/connectivity';
import {unsavedChangesGuard} from '../../core/guards/unsaved-changes.guard';
import {UnsavedChangesService} from '../../service/unsaved-changes.service';
import {AgeClass, BirdStatus, DataEntry, Sex} from '../../models/data-entry.model';
import {RingSize} from '../../models/ring.model';

registerLocaleData(localeDeAt);

/**
 * #478/#493 (ADR 0042, PRD #491): die eine Einheit, die weiß, **was das Öffnen
 * eines Fangs bedeutet** — die Dialog-Konfiguration, ob „Bearbeiten" angeboten
 * oder gesperrt wird und mit welchem Grund, und wohin es führt. Eine Tabelle
 * ruft nur „öffne diesen Fang" und kann die Regel dadurch gar nicht erst anders
 * verdrahten.
 *
 * Geprüft wird am **Ergebnis**, durch den wirklich geöffneten Dialog hindurch:
 * was die Beringer:in sieht, was ein Screenreader erfährt und wo die App danach
 * steht — nicht, welcher Aufruf dorthin geführt hat.
 */
describe('DetailDialogOpener', () => {
  const ZIEL = 'fang-ziel';
  const OFFEN = 'fang-offen';

  function fang(id: string): DataEntry {
    return {
      id,
      species: {id: 's1', common_name_de: 'Kohlmeise', scientific_name: 'Parus major'},
      ring: {id: 'r1', number: '901234', size: RingSize.S},
      staff: {id: 'p1', handle: 'FRE', full_name: 'Filip Reiter'},
      ringing_station: {handle: 'STAMT', name: 'Linz'},
      project: null,
      net_location: null,
      net_height: null,
      net_direction: null,
      feather_span: null,
      wing_span: null,
      tarsus: null,
      notch_f2: null,
      inner_foot: null,
      weight_gram: null,
      bird_status: BirdStatus.ReCatch,
      fat_deposit: null,
      muscle_class: null,
      age_class: AgeClass.ThisYear,
      sex: Sex.Female,
      small_feather_int: null,
      small_feather_app: null,
      hand_wing: null,
      date_time: '2024-05-01T08:30:00Z',
      created: '2024-05-01T08:30:00Z',
      updated: '2024-05-01T08:30:00Z',
      comment: null,
      parasites: [],
      has_hunger_stripes: false,
      has_brood_patch: false,
      has_cpl_plus: false,
      is_dead_recovery: false,
      is_non_standard: false,
    } as unknown as DataEntry;
  }

  /**
   * Der Öffner durch den echten Dialog hindurch: CDK-Overlay, echter Router mit
   * dem echten `unsavedChangesGuard` und der echte Verbindungsdienst.
   */
  describe('was das Öffnen eines Fangs bedeutet', () => {
    /** Die Erfassungsmaske, wie sie unter beiden Routen hängt (`app.routes.ts`). */
    @Component({selector: 'app-capture-stub', standalone: true, template: '<p>Erfassung</p>'})
    class CaptureStubComponent {}

    /** Irgendein Bildschirm, auf dem **kein** Fang offen steht („Letzte Fänge"). */
    @Component({selector: 'app-list-stub', standalone: true, template: '<p>Letzte Fänge</p>'})
    class ListStubComponent {}

    const unsavedChanges = {confirmDiscard: jasmine.createSpy('confirmDiscard')};

    let opener: DetailDialogOpener;
    let overlay: OverlayContainer;
    let router: Router;
    let connectivity: ConnectivityService;

    /** Lässt das CDK das Overlay rendern bzw. schließen (echte Zone). */
    function settle(): Promise<void> {
      return new Promise<void>((resolve) => setTimeout(resolve));
    }

    function container(): HTMLElement {
      return overlay.getContainerElement();
    }

    function knopf(beschriftung: string): HTMLButtonElement | undefined {
      return Array.from(container().querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === beschriftung,
      );
    }

    /** Wartet auf die Navigation, ohne auf eine Dauer zu wetten (#464). */
    async function warteAufUrl(url: string): Promise<void> {
      for (let i = 0; i < 30 && router.url !== url; i++) {
        await settle();
      }
    }

    /** Ein paar Runden Ruhe, damit eine ausbleibende Navigation auch ausbleibt. */
    async function kommtNichtsMehr(): Promise<void> {
      for (let i = 0; i < 5; i++) {
        await settle();
      }
    }

    beforeEach(async () => {
      unsavedChanges.confirmDiscard.calls.reset();
      unsavedChanges.confirmDiscard.and.returnValue(of(true));
      TestBed.configureTestingModule({
        providers: [
          provideNoopAnimations(),
          {provide: LOCALE_ID, useValue: 'de-AT'},
          provideRouter([
            {path: 'data-entries', component: ListStubComponent},
            // Wortgleich aus `app.routes.ts`, nur ohne `authGuard`.
            {path: 'data-entry', component: CaptureStubComponent, canDeactivate: [unsavedChangesGuard]},
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
      opener = TestBed.inject(DetailDialogOpener);
      overlay = TestBed.inject(OverlayContainer);
      router = TestBed.inject(Router);
      connectivity = TestBed.inject(ConnectivityService);
      await router.navigateByUrl('/data-entries');
    });

    afterEach(() => {
      TestBed.inject(MatDialog).closeAll();
      TestBed.inject(OverlayContainer).ngOnDestroy();
    });

    it('zeigt genau diesen Fang', async () => {
      opener.open(fang(ZIEL));
      await settle();

      expect(container().textContent).toContain('901234');
      expect(container().textContent).toContain('Kohlmeise');
    });

    // Django ist ein Werkzeug für Admins: die Navigationsleiste zeigt den Zugang
    // hinter dem Staff-Recht, der Dialog zeigte ihn allen — und für alle anderen
    // endete er an einer Rechtewand.
    it('bietet „Bearbeiten" und keinen Weg in die Django-Administration', async () => {
      opener.open(fang(ZIEL));
      await settle();

      expect(knopf('Bearbeiten')).withContext('„Bearbeiten" vorhanden').toBeDefined();
      expect(container().textContent).not.toContain('Backend');
      expect(container().textContent).not.toContain('Administration');
      const verweise = Array.from(container().querySelectorAll('a')).map(
        (a) => a.getAttribute('href') ?? '',
      );
      expect(verweise.some((href) => href.includes('admin'))).toBeFalse();
    });

    it('führt mit „Bearbeiten" in die Bearbeitungsmaske dieses Fangs', async () => {
      opener.open(fang(ZIEL));
      await settle();

      knopf('Bearbeiten')!.click();
      await warteAufUrl(`/data-entry/${ZIEL}`);

      expect(router.url).toBe(`/data-entry/${ZIEL}`);
      // Der Dialog liegt nicht über dem Bildschirm, auf dem jetzt korrigiert wird.
      expect(container().querySelector('app-data-entry-detail-dialog')).toBeNull();
    });

    /**
     * Der Wächter läuft **nicht** von selbst, wenn von einem geöffneten Fang zu
     * einem anderen gewechselt wird: für den Router ist das dieselbe Route mit
     * anderer Id. Der Öffner benutzt deshalb die geteilte Einheit aus #492 —
     * genau der Fall der Wiederfang-Historie, wo die Beringer:in mitten in einer
     * Erfassung steht.
     */
    it('lässt den Wächter fragen, wenn schon ein Fang offen steht', async () => {
      await router.navigateByUrl(`/data-entry/${OFFEN}`);
      opener.open(fang(ZIEL));
      await settle();

      knopf('Bearbeiten')!.click();
      await warteAufUrl(`/data-entry/${ZIEL}`);

      expect(unsavedChanges.confirmDiscard)
        .withContext('der Wächter wurde gefragt')
        .toHaveBeenCalled();
      expect(router.url).toBe(`/data-entry/${ZIEL}`);
    });

    it('navigiert nicht, wo der Wächter ablehnt — der laufende Fang bleibt stehen', async () => {
      await router.navigateByUrl(`/data-entry/${OFFEN}`);
      unsavedChanges.confirmDiscard.and.returnValue(of(false));
      opener.open(fang(ZIEL));
      await settle();

      knopf('Bearbeiten')!.click();
      await kommtNichtsMehr();

      expect(router.url).toBe(`/data-entry/${OFFEN}`);
    });

    /**
     * Ein synchronisierter Fang ist offline nicht bearbeitbar (append-only,
     * PRD #152). Bisher trug der Zeilenklick in „Heute" diese Regel; sie steht
     * jetzt auf dem Knopf, sonst ginge sie im weiteren Umbau verloren.
     */
    describe('synchronisiert und offline', () => {
      beforeEach(() => {
        connectivity.markOffline();
      });

      it('lässt den Knopf sichtbar, nicht auslösbar, und nennt den Grund', async () => {
        opener.open(fang(ZIEL));
        await settle();

        const bearbeiten = knopf('Bearbeiten')!;
        expect(bearbeiten).withContext('sichtbar geblieben').toBeDefined();
        expect(bearbeiten.getAttribute('aria-disabled')).toBe('true');
        expect(bearbeiten.hasAttribute('disabled'))
          .withContext('kein blankes disabled — sonst überspringt der Screenreader ihn')
          .toBeFalse();

        // Der Grund ist für einen Screenreader erreichbar und sagt beides: warum
        // gerade nicht — und wann wieder (ADR 0037).
        const beschriebenVon = bearbeiten.getAttribute('aria-describedby')!;
        const grund = container().querySelector(`#${beschriebenVon}`)!.textContent!;
        expect(grund).toContain('synchronisiert');
        expect(grund).toContain('Verbindung');
      });

      it('geht auf einen Tipp nirgendwohin', async () => {
        opener.open(fang(ZIEL));
        await settle();

        knopf('Bearbeiten')!.click();
        await kommtNichtsMehr();

        expect(router.url).toBe('/data-entries');
      });

      // Die Sperre gilt der Reichweite des Geräts, nicht dem Alter des Fangs.
      it('wird wieder auslösbar, sobald das Gerät den Server wieder erreicht', async () => {
        opener.open(fang(ZIEL));
        await settle();
        expect(knopf('Bearbeiten')!.getAttribute('aria-disabled')).toBe('true');

        connectivity.markOnline();
        TestBed.inject(ApplicationRef).tick();

        const bearbeiten = knopf('Bearbeiten')!;
        expect(bearbeiten.getAttribute('aria-disabled')).toBeNull();
        bearbeiten.click();
        await warteAufUrl(`/data-entry/${ZIEL}`);
        expect(router.url).toBe(`/data-entry/${ZIEL}`);
      });
    });

    /**
     * Der Fall ist eng: nur synchronisiert **und** offline. Ein nicht
     * synchronisierter Fang ist offline bearbeitbar — das ist der Sinn der
     * Warteschlange —, sein Knopf funktioniert immer.
     */
    it('lässt einen nicht synchronisierten Fang auch offline bearbeiten', async () => {
      connectivity.markOffline();
      opener.open(fang(ZIEL), {synchronisiert: false});
      await settle();

      const bearbeiten = knopf('Bearbeiten')!;
      expect(bearbeiten.getAttribute('aria-disabled')).toBeNull();

      bearbeiten.click();
      await warteAufUrl(`/data-entry/${ZIEL}`);
      expect(router.url).toBe(`/data-entry/${ZIEL}`);
    });
  });

  /**
   * #478 (ADR 0042): die Dialog-Konfiguration steht nur noch hier — vorher
   * wortgleich in `DataEntryFormComponent.openDetailDialog()` und
   * `TodaySessionComponent.openSynced()`. Die beiden Maße sind bekannt-gute
   * Literale aus der abgelösten Kopie, hier nicht nachgerechnet.
   */
  describe('Dialog-Konfiguration', () => {
    let dialog: jasmine.SpyObj<MatDialog>;
    let opener: DetailDialogOpener;

    beforeEach(() => {
      dialog = jasmine.createSpyObj('MatDialog', ['open']);
      TestBed.configureTestingModule({
        providers: [provideRouter([]), {provide: MatDialog, useValue: dialog}],
      });
      opener = TestBed.inject(DetailDialogOpener);
    });

    it('öffnet den Detail-Dialog zu genau diesem Fang', () => {
      const eintrag = fang(ZIEL);

      opener.open(eintrag);

      expect(dialog.open).toHaveBeenCalledTimes(1);
      const [komponente, config] = dialog.open.calls.mostRecent().args as [
        unknown,
        {data: {fang: DataEntry}},
      ];
      expect(komponente).toBe(DataEntryDetailDialogComponent);
      expect(config.data.fang).toBe(eintrag);
    });

    it('trägt die Dialog-Konfiguration als einzige Stelle', () => {
      opener.open(fang(ZIEL));

      const config = dialog.open.calls.mostRecent().args[1] as {
        width: string;
        maxHeight: string;
      };
      expect(config.width).toBe('640px');
      expect(config.maxHeight).toBe('90vh');
    });
  });
});
