import {Component, signal} from '@angular/core';
import {ComponentFixture, TestBed} from '@angular/core/testing';

import {MarkerSlotsComponent} from './marker-slots';
import {DataEntry} from '../../models/data-entry.model';
import {OptionalField, Project} from '../../models/project.model';
import {ProjectService} from '../../service/project.service';

/**
 * #468: der Spec der geteilten Marker-Slots. Die Komponente ist rein
 * präsentational — Eintrag rein, drei Slots raus —, deshalb wird sie hier direkt
 * geprüft und nicht durch eine der beiden Fang-Tabellen. „Letzte Fänge" und die
 * Wiederfang-Historie konsumieren dieselbe Komponente; ein Beweis hier gilt für
 * beide.
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
 * Detail-Dialog bzw. den Fang. Die Marker-Spalte ist nur Information.
 */
@Component({
  imports: [MarkerSlotsComponent],
  template: `
    <div class="zeile" (click)="tipps = tipps + 1">
      <app-marker-slots [entry]="entry" />
    </div>
  `,
})
class ZeileMitMarkern {
  readonly entry = fang({has_brood_patch: true});
  tipps = 0;
}

describe('MarkerSlotsComponent', () => {
  let fixture: ComponentFixture<MarkerSlotsComponent>;

  function render(entry: DataEntry): HTMLElement {
    fixture = TestBed.createComponent(MarkerSlotsComponent);
    fixture.componentRef.setInput('entry', entry);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const infoIcon = (el: HTMLElement): HTMLElement | null =>
    el.querySelector('[data-testid="bemerkung-icon"]');

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MarkerSlotsComponent, ZeileMitMarkern],
      providers: [
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

    expect(infoIcon(el)).not.toBeNull();
  });

  it('zeigt das ⓘ bei gesetztem CPL+, auch ohne Bemerkung', () => {
    const el = render(fang({has_cpl_plus: true}));

    expect(infoIcon(el)).not.toBeNull();
  });

  it('lässt den ⓘ-Slot leer, wenn die Zeile nichts Zusätzliches trägt', () => {
    const el = render(fang());

    expect(infoIcon(el)).toBeNull();
    // Der Slot selbst bleibt stehen und behält seine Breite (#388).
    expect(el.querySelector('[data-testid="marker-slot-bemerkung"]')).not.toBeNull();
  });

  // #468: die vier Zeilen der Tooltip-Tabelle des Tickets, jeder Teil nur wenn
  // vorhanden. Die erwarteten Texte stehen wörtlich im Ticket — sie werden hier
  // nicht nachgerechnet, sondern als bekannt-gute Literale behauptet.
  describe('setzt den Text beschriftet zusammen', () => {
    it('nennt bei nur Merkmalen allein die Vokabeln', () => {
      const el = render(fang({has_brood_patch: true, has_cpl_plus: true}));

      expect(infoIcon(el)!.getAttribute('title')).toBe('Brutfleck, CPL+');
    });

    it('kennzeichnet die freie Bemerkung als „Bemerkung: …"', () => {
      const el = render(fang({comment: 'Ring saß locker'}));

      expect(infoIcon(el)!.getAttribute('title')).toBe('Bemerkung: Ring saß locker');
    });

    it('stellt bei beidem die Vokabeln vor die gekennzeichnete Bemerkung', () => {
      const el = render(
        fang({has_brood_patch: true, has_cpl_plus: true, comment: 'Ring saß locker'}),
      );

      expect(infoIcon(el)!.getAttribute('title')).toBe(
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

      expect(infoIcon(el)!.getAttribute('title')).toBe(
        'Brutfleck — Bemerkung: Totfund; Umstände: Katze',
      );
    });
  });

  it('gibt Screenreader-Beschriftung und Tooltip denselben Text', () => {
    const el = render(fang({has_cpl_plus: true, comment: 'Ring saß locker'}));

    const icon = infoIcon(el)!;
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

    const text = infoIcon(el)!.getAttribute('title')!;
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

    expect(infoIcon(el)).not.toBeNull();
    expect(infoIcon(el)!.getAttribute('title')).toBe('Brutfleck, CPL+');
  });

  // #468: der Weg zum Ganzen bleibt der Klick auf die Zeile — auf dem Tablet
  // kennt ein Tooltip keinen Hover. Die Marker-Spalte bleibt deshalb passiv und
  // schluckt den Klick nicht: er steigt zur Zeile auf, die ihn zum Detail-Dialog
  // trägt.
  it('schluckt den Klick nicht, sondern lässt ihn zur Zeile aufsteigen', () => {
    const host = TestBed.createComponent(ZeileMitMarkern);
    host.detectChanges();
    const el = host.nativeElement as HTMLElement;

    const icon = el.querySelector<HTMLElement>('[data-testid="bemerkung-icon"]')!;
    icon.click();

    expect(host.componentInstance.tipps).toBe(1);
  });
});
