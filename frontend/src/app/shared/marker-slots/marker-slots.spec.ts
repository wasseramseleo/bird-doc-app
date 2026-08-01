import {Component, signal} from '@angular/core';
import {ComponentFixture, TestBed} from '@angular/core/testing';
import {MatDialog} from '@angular/material/dialog';

import {MarkerSlotsComponent} from './marker-slots';
import {DataEntry} from '../../models/data-entry.model';
import {FangLesemodell, lesemodellAusFang} from '../detail-dialog/fang-lesemodell';
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
 * Detail-Dialog bzw. den Fang.
 *
 * #478 (ADR 0042): sie trägt ihn nur noch für die **Fangmarker**. Das
 * Detail-Zeichen ist ein Knopf mit eigenem Ziel und schluckt seinen Klick;
 * dieser Host beweist beide Hälften, deshalb trägt sein Fang alle drei Slots.
 *
 * Die Polsterung steht stellvertretend für die Zellenpolsterung der echten
 * Tabellen: in sie hinein wächst die Trefferfläche des Detail-Zeichens, und ohne
 * sie läge der Messpunkt links davon außerhalb des Fensters.
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

  // #478 (ADR 0042): das Detail-Zeichen ist ein echter Knopf und löst sein
  // eigenes Versprechen ein — es öffnet den Detail-Dialog. Ein natives `title`
  // hat keinerlei Touch-Verhalten; auf dem Tablet, dem Fall für den das
  // Antippen gedacht war, ist der Tap der einzige Weg. Was beim Antippen
  // passiert, trägt `aria-haspopup` und *nicht* ein Präfix im zugänglichen
  // Namen: eine Liste mit 50 Zeilen soll nicht 50× dieselbe Vorrede vorlesen.
  it('ist ein Knopf, der einen Dialog ankündigt, ohne seinen Namen zu ändern', () => {
    const el = render(fang({has_cpl_plus: true, comment: 'Ring saß locker'}));

    const zeichen = detailZeichen(el)!;
    expect(zeichen.tagName).toBe('BUTTON');
    expect((zeichen as HTMLButtonElement).type).toBe('button');
    expect(zeichen.getAttribute('aria-haspopup')).toBe('dialog');
    // Unverändert das Bemerkenswerte, wortgleich mit dem Tooltip.
    expect(zeichen.getAttribute('aria-label')).toBe('CPL+ — Bemerkung: Ring saß locker');
    expect(zeichen.getAttribute('title')).toBe(zeichen.getAttribute('aria-label'));
  });

  it('öffnet den Detail-Dialog zu diesem Fang', () => {
    const entry = fang({has_brood_patch: true});
    const el = render(entry);

    detailZeichen(el)!.click();

    expect(dialog.open).toHaveBeenCalledTimes(1);
    const config = dialog.open.calls.mostRecent().args[1] as {data: {fang: FangLesemodell}};
    expect(config.data.fang).toEqual(lesemodellAusFang(entry));
  });

  // #478 (ADR 0042), Hälfte 1 des umgekehrten Paares: das Detail-Zeichen hat ein
  // eigenes Ziel und schluckt seinen Klick. Ließe es ihn aufsteigen, navigierte
  // „Letzte Fänge" zusätzlich in die Bearbeitungsmaske und die Historie öffnete
  // den Dialog doppelt — #478 wäre lautlos wiederhergestellt.
  it('schluckt den Klick auf das Detail-Zeichen', () => {
    const host = TestBed.createComponent(ZeileMitMarkern);
    host.detectChanges();
    const el = host.nativeElement as HTMLElement;

    detailZeichen(el)!.click();

    expect(host.componentInstance.tipps).toBe(0);
  });

  // #478 (ADR 0042), Hälfte 2: für ♥ und ⚑ gilt #405 unverändert weiter — „die
  // Zeile trägt den Klick, die Spalte trägt nur Information". Sie sind keine
  // Knöpfe und lassen ihren Klick aufsteigen; das Detail-Zeichen ist die
  // benannte Ausnahme, nicht die neue Regel.
  it('lässt den Klick auf die übrigen Slots zur Zeile aufsteigen', () => {
    const host = TestBed.createComponent(ZeileMitMarkern);
    host.detectChanges();
    const el = host.nativeElement as HTMLElement;

    el.querySelector<HTMLElement>('[data-testid="tot-fund-icon"]')!.click();
    el.querySelector<HTMLElement>('[data-testid="non-standard-icon"]')!.click();

    expect(host.componentInstance.tipps).toBe(2);
  });

  // #478: „sichtbar gleich groß, tastbar größer". Der Slot ist 1.05rem breit und
  // „ein leerer Slot behält seine Breite" ist die Invariante, die die Spalte
  // vertikal abscannbar macht — ein `mat-icon-button` (40–48px) würde dieses
  // Raster sprengen und jede Zeile einer Tabelle wachsen lassen, deren
  // Seitengröße 50 beträgt (#374). Gemessen wird gegen den Nachbarn im Raster,
  // nicht gegen eine hier wiederholte Zahl.
  describe('Trefferfläche', () => {
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

    it('nimmt Tipps neben und über dem Zeichen entgegen', () => {
      const {zeichen} = zeileImDokument();
      const r = zeichen.getBoundingClientRect();

      // Links davon liegt die Zellenpolsterung — freier Raum, der keinem anderen
      // Ziel gehört.
      expect(zeichen.contains(document.elementFromPoint(r.left - 6, r.top + r.height / 2)))
        .withContext('links neben dem Zeichen')
        .toBeTrue();
      // Und vertikal über die Zeilenhöhe, nicht nur über die Glyphe.
      expect(zeichen.contains(document.elementFromPoint(r.left + r.width / 2, r.top - 6)))
        .withContext('über dem Zeichen')
        .toBeTrue();
    });

    // Eine 44er-Fläche wäre größer, würde aber die Bedeutung eines Tipps auf ♥
    // davon abhängig machen, ob zufällig ein ⓘ danebensteht. Ein synthetischer
    // `.click()` auf das Element liefe dabei weiter grün — deshalb wird hier
    // gezielt am Punkt getroffen, an dem die Beringer:in tippt.
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
