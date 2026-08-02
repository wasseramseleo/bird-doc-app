import {Component, signal} from '@angular/core';
import {ComponentFixture, TestBed} from '@angular/core/testing';
import {MatDialog} from '@angular/material/dialog';

import {MarkerSlotsComponent} from './marker-slots';
import {DataEntry} from '../../models/data-entry.model';
import {OptionalField, Project} from '../../models/project.model';
import {ProjectService} from '../../service/project.service';

/**
 * #468: der Spec der geteilten Marker-Slots. Was die Komponente *aus einem
 * Eintrag macht* — welche Slots belegt sind und was das Detail-Zeichen im
 * Tooltip nennt — wird hier direkt geprüft und nicht durch eine der beiden
 * Fang-Tabellen. „Letzte Fänge" und die Wiederfang-Historie konsumieren dieselbe
 * Komponente; ein Beweis hier gilt für beide.
 *
 * #478 (ADR 0042): **nicht alles** lässt sich hier beweisen. Ob ein Klick zur
 * Zeile aufsteigt und was die Tabelle dann tut, ist eine Eigenschaft der
 * Komposition — die beiden Pins dafür liegen auf Tabellenebene
 * (`data-entry-list.spec.ts`, `data-entry-form.spec.ts`). Dieses Issue existiert,
 * weil die Verdrahtung ungetestet blieb, während die Komponente gut abgedeckt
 * war.
 *
 * #497 (PRD #491): das Detail-Zeichen ist wieder ein reines Zeichen. Was hier
 * geprüft wird, ist deshalb wieder **Darstellung** — welche Slots belegt sind
 * und welchen Text das ⓘ nennt. Dass ein Tipp darauf den Detail-Dialog **genau
 * einmal** öffnet, ist erst recht eine Aussage über die Komposition und steht
 * je Tabelle.
 */
function fang(overrides: Partial<DataEntry> = {}): DataEntry {
  return {
    id: 'fang-1',
    comment: null,
    has_brood_patch: false,
    has_cpl_plus: false,
    is_dead_recovery: false,
    is_non_standard: false,
    ...overrides,
  } as unknown as DataEntry;
}

/**
 * Die Zeile, die den Klick trägt — beide Tabellen öffnen von ihr aus den
 * Detail-Dialog.
 *
 * #497 (PRD #491): sie trägt ihn wieder für **alle drei** Slots. Das
 * Detail-Zeichen schluckt seinen Klick nicht mehr — es steigt auf wie der von
 * ♥ und ⚑ (#405: „die Zeile trägt den Klick, die Spalte trägt nur
 * Information"). Dieser Host beweist beide Hälften, deshalb trägt sein Fang
 * alle drei Slots.
 *
 * Die Polsterung steht stellvertretend für die Zellenpolsterung der echten
 * Tabellen.
 */
@Component({
  imports: [MarkerSlotsComponent],
  template: `
    <div class="zeile" style="padding: 12px 0 12px 24px" (click)="tipps = tipps + 1">
      <app-marker-slots [entry]="entry" />
    </div>
  `,
})
class ZeileMitMarkern {
  readonly entry = fang({
    has_brood_patch: true,
    is_dead_recovery: true,
    is_non_standard: true,
  });
  tipps = 0;
}

describe('MarkerSlotsComponent', () => {
  let fixture: ComponentFixture<MarkerSlotsComponent>;
  let dialog: jasmine.SpyObj<MatDialog>;

  function render(entry: DataEntry): HTMLElement {
    fixture = TestBed.createComponent(MarkerSlotsComponent);
    fixture.componentRef.setInput('entry', entry);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const detailZeichen = (el: HTMLElement): HTMLElement | null =>
    el.querySelector('[data-testid="detail-zeichen"]');

  beforeEach(async () => {
    dialog = jasmine.createSpyObj('MatDialog', ['open']);

    await TestBed.configureTestingModule({
      imports: [MarkerSlotsComponent, ZeileMitMarkern],
      providers: [
        {provide: MatDialog, useValue: dialog},
        // Ein Projekt, das Brutfleck und CPL+ abgeschaltet hat. Die Komponente
        // fragt es nie — steht es hier bereit, ist die Behauptung „kennt die
        // Konfiguration nicht" geprüft und nicht bloß behauptet.
        {
          provide: ProjectService,
          useValue: {
            currentProject: signal({
              id: 'p-1',
              hidden_optional_fields: [OptionalField.Brutfleck, OptionalField.CplPlus],
            } as unknown as Project),
          },
        },
      ],
    }).compileComponents();
  });

  // #468: das ⓘ bedeutet nicht mehr „hat Bemerkung", sondern „in dieser Zeile
  // steht mehr, als die Spalten zeigen". Brutfleck und CPL+ haben in keiner der
  // beiden Fang-Tabellen eine Spalte — ohne das ⓘ weiß die Beringer:in nicht
  // einmal, dass es etwas zu erfahren gibt.
  it('zeigt das ⓘ bei gesetztem Brutfleck, auch ohne Bemerkung', () => {
    const el = render(fang({has_brood_patch: true}));

    expect(detailZeichen(el)).not.toBeNull();
  });

  it('zeigt das ⓘ bei gesetztem CPL+, auch ohne Bemerkung', () => {
    const el = render(fang({has_cpl_plus: true}));

    expect(detailZeichen(el)).not.toBeNull();
  });

  it('lässt den ⓘ-Slot leer, wenn die Zeile nichts Zusätzliches trägt', () => {
    const el = render(fang());

    expect(detailZeichen(el)).toBeNull();
    // Der Slot selbst bleibt stehen und behält seine Breite (#388).
    expect(el.querySelector('[data-testid="marker-slot-bemerkung"]')).not.toBeNull();
  });

  // #468: die vier Zeilen der Tooltip-Tabelle des Tickets, jeder Teil nur wenn
  // vorhanden. Die erwarteten Texte stehen wörtlich im Ticket — sie werden hier
  // nicht nachgerechnet, sondern als bekannt-gute Literale behauptet.
  describe('setzt den Text beschriftet zusammen', () => {
    it('nennt bei nur Merkmalen allein die Vokabeln', () => {
      const el = render(fang({has_brood_patch: true, has_cpl_plus: true}));

      expect(detailZeichen(el)!.getAttribute('title')).toBe('Brutfleck, CPL+');
    });

    it('kennzeichnet die freie Bemerkung als „Bemerkung: …"', () => {
      const el = render(fang({comment: 'Ring saß locker'}));

      expect(detailZeichen(el)!.getAttribute('title')).toBe('Bemerkung: Ring saß locker');
    });

    it('stellt bei beidem die Vokabeln vor die gekennzeichnete Bemerkung', () => {
      const el = render(
        fang({has_brood_patch: true, has_cpl_plus: true, comment: 'Ring saß locker'}),
      );

      expect(detailZeichen(el)!.getAttribute('title')).toBe(
        'Brutfleck, CPL+ — Bemerkung: Ring saß locker',
      );
    });

    // Die Kennzeichnung ist nicht Zierde: ein Tot-Fund komponiert seinen
    // Bemerkungstext selbst und würde ohne „Bemerkung: " wie eine weitere
    // Vokabel gelesen.
    it('hält den selbstkomponierten Tot-Fund-Text von den Vokabeln getrennt', () => {
      const el = render(
        fang({
          has_brood_patch: true,
          is_dead_recovery: true,
          comment: 'Totfund; Umstände: Katze',
        }),
      );

      expect(detailZeichen(el)!.getAttribute('title')).toBe(
        'Brutfleck — Bemerkung: Totfund; Umstände: Katze',
      );
    });
  });

  it('gibt Screenreader-Beschriftung und Tooltip denselben Text', () => {
    const el = render(fang({has_cpl_plus: true, comment: 'Ring saß locker'}));

    const icon = detailZeichen(el)!;
    expect(icon.getAttribute('aria-label')).toBe('CPL+ — Bemerkung: Ring saß locker');
    expect(icon.getAttribute('aria-label')).toBe(icon.getAttribute('title'));
  });

  // #468: die genannten Vokabeln sind wortgleich mit denen, die der IWM-Export
  // in die Melde-Bemerkung schreibt (`_build_comment` in
  // `backend/birds/iwm_export.py`) — die Beringer:in lernt nicht zwei Wörter für
  // eine Sache. Insbesondere heißt CPL+ hier nicht „Kloake": das ist die
  // Spaltenüberschrift der Meldestelle, nicht der Name des Merkmals.
  it('nennt die Merkmale wortgleich mit der IWM-Melde-Bemerkung', () => {
    const el = render(fang({has_brood_patch: true, has_cpl_plus: true}));

    const text = detailZeichen(el)!.getAttribute('title')!;
    expect(text).toContain('Brutfleck');
    expect(text).toContain('CPL+');
    expect(text).not.toContain('Kloake');
    expect(text).not.toContain('Bebrütungsfleck');
  });

  // #468 (dieselbe Linie wie ADR 0035): das ⓘ nennt, was der *Datensatz* trägt.
  // Ein Projekt, das Brutfleck und CPL+ abgeschaltet hat, sieht den an einem
  // historischen Fang erhobenen Brutfleck weiterhin — er wurde am Vogel erhoben,
  // nicht am Formular. Die Optionale-Felder-Konfiguration steht in diesem TestBed
  // bereit und wird trotzdem nicht gelesen.
  it('kennt die Optionale-Felder-Konfiguration des Projekts nicht', () => {
    const abgeschaltet = TestBed.inject(ProjectService).currentProject()!.hidden_optional_fields;
    expect(abgeschaltet).toContain(OptionalField.Brutfleck);

    const el = render(fang({has_brood_patch: true, has_cpl_plus: true}));

    expect(detailZeichen(el)).not.toBeNull();
    expect(detailZeichen(el)!.getAttribute('title')).toBe('Brutfleck, CPL+');
  });

  // #497 (PRD #491): das Detail-Zeichen ist wieder ein reines Zeichen. #478
  // machte es zum Knopf, weil ein natives `title` keinerlei Touch-Verhalten hat
  // — auf dem Tablet war der Tipp der einzige Weg zur Information, und er
  // führte in „Letzte Fänge" in die Bearbeitungsmaske. Führt der Tipp über die
  // Zeile ohnehin zum Detail-Dialog (#494), ist diese Prämisse weg: das Zeichen
  // muss den Weg nicht mehr selbst tragen, weil die Zeile ihn trägt.
  //
  // Es behält, was nichts anderes trägt: *das Bemerkenswerte* als Tooltip und
  // zugängliche Beschriftung.
  it('ist kein Knopf und kündigt keinen Dialog an, behält aber das Bemerkenswerte', () => {
    const el = render(fang({has_cpl_plus: true, comment: 'Ring saß locker'}));

    const zeichen = detailZeichen(el)!;
    expect(zeichen.tagName).not.toBe('BUTTON');
    expect(zeichen.getAttribute('aria-haspopup')).toBeNull();
    // Unverändert das Bemerkenswerte, wortgleich mit dem Tooltip.
    expect(zeichen.getAttribute('aria-label')).toBe('CPL+ — Bemerkung: Ring saß locker');
    expect(zeichen.getAttribute('title')).toBe(zeichen.getAttribute('aria-label'));
    // …und das Bemerkenswerte ist *hörbar*. Solange es der Knopf trug, war das
    // umsonst zu haben; auf einem blanken `mat-icon` nicht: MatIcon setzt sich
    // im Konstruktor selbst `aria-hidden="true"`, sobald im Template kein
    // **statisches** `aria-hidden` steht (er liest ein `HostAttributeToken`,
    // das eine `[attr.…]`-Bindung nicht sieht). Ein `aria-label` auf einem aus
    // dem Zugänglichkeitsbaum genommenen Element ist keine zugängliche
    // Beschriftung — und die drei Zeilen darüber blieben trotzdem grün.
    expect(zeichen.getAttribute('aria-hidden')).not.toBe('true');
  });

  // #497: die Komponente ist wieder **rein präsentational** — sie kennt den
  // Dialog-Öffner nicht mehr. Ein Tipp auf das Zeichen öffnet von hier aus
  // nichts; was ein Tipp bedeutet, entscheidet die Zeile darunter. Der
  // MatDialog steht in diesem TestBed bereit, damit „öffnet selbst nichts"
  // geprüft und nicht bloß behauptet ist.
  it('öffnet selbst keinen Dialog — die Komponente ist rein präsentational', () => {
    const el = render(fang({has_brood_patch: true}));

    detailZeichen(el)!.click();

    expect(dialog.open).not.toHaveBeenCalled();
  });

  // #497, Hälfte 1 des wiederhergestellten Paares: das Detail-Zeichen lässt
  // seinen Klick zur Zeile aufsteigen wie ♥ und ⚑. Schluckte es ihn weiter,
  // bliebe ein Tipp darauf in „Letzte Fänge" wirkungslos — die Zeile trägt den
  // Weg zum Detail-Dialog jetzt allein.
  it('lässt den Klick auf das Detail-Zeichen zur Zeile aufsteigen', () => {
    const host = TestBed.createComponent(ZeileMitMarkern);
    host.detectChanges();
    const el = host.nativeElement as HTMLElement;

    detailZeichen(el)!.click();

    expect(host.componentInstance.tipps).toBe(1);
  });

  // #497, Hälfte 2: für ♥ und ⚑ gilt #405 unverändert weiter — „die Zeile trägt
  // den Klick, die Spalte trägt nur Information". Sie verhalten sich durch
  // diesen Schnitt in keiner Weise anders; das Detail-Zeichen ist jetzt wieder
  // eines von dreien statt der benannten Ausnahme.
  it('lässt den Klick auf die übrigen Slots zur Zeile aufsteigen', () => {
    const host = TestBed.createComponent(ZeileMitMarkern);
    host.detectChanges();
    const el = host.nativeElement as HTMLElement;

    el.querySelector<HTMLElement>('[data-testid="tot-fund-icon"]')!.click();
    el.querySelector<HTMLElement>('[data-testid="non-standard-icon"]')!.click();

    expect(host.componentInstance.tipps).toBe(2);
  });

  // #388/#478/#497: die drei Slots sind gleich groß und überlappen einander
  // nicht — das ist die Invariante, die die Spalte vertikal abscannbar macht.
  // Gemessen wird gegen den Nachbarn im Raster, nicht gegen eine hier
  // wiederholte Zahl.
  //
  // #497: die vergrößerte Trefferfläche des Knopfes (#478) ist mit dem Knopf
  // weg. Sie war die Affordance eines eigenen Ziels; das Ziel ist jetzt die
  // ganze Zeile, und die ist von sich aus groß genug.
  describe('Slot-Raster', () => {
    function zeileImDokument(): {zeichen: HTMLElement; wurzel: HTMLElement} {
      const host = TestBed.createComponent(ZeileMitMarkern);
      host.detectChanges();
      const wurzel = host.nativeElement as HTMLElement;
      wurzel.scrollIntoView();
      return {zeichen: detailZeichen(wurzel)!, wurzel};
    }

    it('lässt das Detail-Zeichen sichtbar so groß wie die übrigen Marker', () => {
      const {zeichen, wurzel} = zeileImDokument();

      const nachbar = wurzel
        .querySelector<HTMLElement>('[data-testid="tot-fund-icon"]')!
        .getBoundingClientRect();
      const eigen = zeichen.getBoundingClientRect();

      expect(Math.abs(eigen.width - nachbar.width)).toBeLessThan(1);
      expect(Math.abs(eigen.height - nachbar.height)).toBeLessThan(1);
    });

    // Ein Zeichen, das über seinen Slot hinauswächst, machte die Bedeutung
    // eines Tipps auf ♥ davon abhängig, ob zufällig ein ⓘ danebensteht. Ein
    // synthetischer `.click()` auf das Element liefe dabei weiter grün —
    // deshalb wird hier gezielt am Punkt getroffen, an dem die Beringer:in
    // tippt.
    it('überlappt weder den ♥- noch den ⚑-Slot', () => {
      const {zeichen, wurzel} = zeileImDokument();

      for (const testid of ['tot-fund-icon', 'non-standard-icon']) {
        const r = wurzel.querySelector<HTMLElement>(`[data-testid="${testid}"]`)!
          .getBoundingClientRect();
        const getroffen = document.elementFromPoint(
          r.left + r.width / 2,
          r.top + r.height / 2,
        );

        expect(zeichen.contains(getroffen))
          .withContext(`${testid} gehört sich selbst`)
          .toBeFalse();
      }
    });
  });
});
