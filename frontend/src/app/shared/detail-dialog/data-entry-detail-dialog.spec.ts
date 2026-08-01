import { LOCALE_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { registerLocaleData } from '@angular/common';
import localeDeAt from '@angular/common/locales/de-AT';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import {
  BearbeitenAngebot,
  DataEntryDetailDialogComponent,
  DetailDialogDaten,
} from './data-entry-detail-dialog';
import { AgeClass, BirdStatus, DataEntry, Parasit, Sex } from '../../models/data-entry.model';
import { RingSize } from '../../models/ring.model';
import { Central } from '../../models/central.model';

registerLocaleData(localeDeAt);

describe('DataEntryDetailDialogComponent (Zentrale, US 19 / #232)', () => {
  function baseEntry(): DataEntry {
    return {
      id: '1',
      species: { id: 's1', common_name_de: 'Kohlmeise', scientific_name: 'Parus major' },
      ring: { id: 'r1', number: '901234', size: RingSize.S },
      staff: { id: 'p1', handle: 'FRE', full_name: 'Filip Reiter' },
      ringing_station: { handle: 'STAMT', name: 'Linz' },
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
   * Was der geteilte Öffner mitgibt, wenn er den Dialog aufmacht (#493): der
   * Fang, ob „Bearbeiten" angeboten oder gesperrt ist — und wohin es führt. Der
   * Dialog entscheidet davon nichts selbst; er zeigt es und ruft zurück.
   */
  const angebot = signal<BearbeitenAngebot>({ gesperrt: false, grund: null });
  let bearbeiteFang: jasmine.Spy;
  let dialogRef: jasmine.SpyObj<MatDialogRef<DataEntryDetailDialogComponent>>;

  async function render(entry: DataEntry): Promise<ComponentFixture<DataEntryDetailDialogComponent>> {
    TestBed.resetTestingModule();
    bearbeiteFang = jasmine.createSpy('bearbeiteFang');
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    const daten: DetailDialogDaten = {
      fang: entry,
      bearbeiten: angebot.asReadonly(),
      bearbeiteFang: () => bearbeiteFang(),
    };
    await TestBed.configureTestingModule({
      imports: [DataEntryDetailDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: LOCALE_ID, useValue: 'de-AT' },
        { provide: MAT_DIALOG_DATA, useValue: daten },
        { provide: MatDialogRef, useValue: dialogRef },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(DataEntryDetailDialogComponent);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    angebot.set({ gesperrt: false, grund: null });
  });

  const zentraleText = (fixture: ComponentFixture<DataEntryDetailDialogComponent>) =>
    (
      fixture.nativeElement.querySelector('[data-testid="detail-zentrale"]') as HTMLElement
    ).textContent!.trim();

  it('shows the ring Zentrale for a foreign recapture (name + scheme code)', async () => {
    const slovak: Central = {
      id: 'c-skb',
      scheme_code: 'SKB',
      name: 'Slowakei Bratislava',
      country: 'Slowakei',
    };
    const entry = baseEntry();
    entry.ring.central = slovak;

    const fixture = await render(entry);

    expect(zentraleText(fixture)).toContain('Slowakei Bratislava');
    expect(zentraleText(fixture)).toContain('SKB');
  });

  it('shows the domestic Zentrale for an AUW ring', async () => {
    const entry = baseEntry();
    entry.ring.central = {
      id: 'c-auw',
      scheme_code: 'AUW',
      name: 'Österreichische Vogelwarte',
      country: 'Österreich',
    };

    const fixture = await render(entry);

    expect(zentraleText(fixture)).toContain('AUW');
  });

  it('falls back to a dash when the ring carries no stored Zentrale', async () => {
    const fixture = await render(baseEntry());

    expect(zentraleText(fixture)).toBe('—');
  });

  // #469: der Detail-Dialog ist die vierte der fünf Aufrufstellen. Er holt das
  // Wort im geteilten Beschriftungsmodul — und bei einem Ring vernichtet, dem
  // das Backend den Ringstatus geleert hat, ist das ein Gedankenstrich.
  describe('Ringstatus', () => {
    const statusCell = (fixture: ComponentFixture<DataEntryDetailDialogComponent>) =>
      (Array.from(fixture.nativeElement.querySelectorAll('dt')) as HTMLElement[])
        .find(dt => dt.textContent!.trim() === 'Status')!
        .nextElementSibling as HTMLElement;

    it('names the Ringstatus of an ordinary capture', async () => {
      const fixture = await render(baseEntry());

      expect(statusCell(fixture).textContent!.trim()).toBe('Wiederfang');
    });

    it('shows a bare dash and no badge for a Ring-vernichtet capture', async () => {
      const entry = baseEntry();
      entry.species = {
        id: 'sent',
        common_name_de: 'Ring Vernichtet',
        scientific_name: '',
        special_kind: 'ring_destroyed',
      } as never;
      (entry as { bird_status: BirdStatus | null }).bird_status = null;

      const fixture = await render(entry);

      const cell = statusCell(fixture);
      expect(cell.textContent!.trim()).toBe('—');
      expect(cell.querySelector('.status-badge')).toBeNull();
    });
  });

  // Parasit vocabulary (issue #406): a capture migrated off the retired „Milben"
  // code must read as Rote Milben here, not as a raw `red_mites`.
  describe('Parasit labels', () => {
    const parasitText = (fixture: ComponentFixture<DataEntryDetailDialogComponent>) =>
      (
        Array.from(fixture.nativeElement.querySelectorAll('dt')) as HTMLElement[]
      )
        .find(dt => dt.textContent!.trim() === 'Parasit')!
        .nextElementSibling!.textContent!.trim();

    it('renders a migrated Milben capture as Rote Milben', async () => {
      const entry = baseEntry();
      (entry as DataEntry).parasites = [Parasit.RedMites];

      const fixture = await render(entry);

      expect(parasitText(fixture)).toBe('Rote Milben');
    });

    it('renders several parasite types comma-separated', async () => {
      const entry = baseEntry();
      (entry as DataEntry).parasites = [Parasit.RedMites, Parasit.Tick];

      const fixture = await render(entry);

      expect(parasitText(fixture)).toBe('Rote Milben, Zecke');
    });
  });

  // Fettvorrat (issue #467): der Dialog trägt dieselbe Beschriftung wie die
  // Erfassungsmaske. „Fett" ist allein die Spaltenüberschrift der IWM-Meldedatei
  // — dieselbe Spaltung wie CPL+/Kloake (CONTEXT.md).
  describe('Kondition labels', () => {
    const labels = (fixture: ComponentFixture<DataEntryDetailDialogComponent>) =>
      (Array.from(fixture.nativeElement.querySelectorAll('dt')) as HTMLElement[]).map(dt =>
        dt.textContent!.trim(),
      );

    it('names the fat reserve Fettvorrat, never the export column Fett', async () => {
      const fixture = await render(baseEntry());

      expect(labels(fixture)).toContain('Fettvorrat');
      expect(labels(fixture)).not.toContain('Fett');
    });

    it('leaves Muskelklasse beside it untouched', async () => {
      const fixture = await render(baseEntry());

      expect(labels(fixture)).toContain('Muskelklasse');
    });
  });

  /**
   * #493 (PRD #491): der Dialog verliert „Im Backend öffnen" und bekommt an
   * dessen Stelle „Bearbeiten".
   *
   * Django ist ein Werkzeug für Admins — die Navigationsleiste zeigt den Zugang
   * bewusst nur Mitgliedern mit Staff-Recht, der Dialog zeigte ihn allen, und für
   * alle anderen endete er an einer Rechtewand. An seine Stelle tritt der Weg,
   * den eine Beringer:in wirklich braucht: vom Lesen zum Korrigieren.
   *
   * Geprüft wird hier, was der Dialog **zeigt und meldet**. Ob „Bearbeiten"
   * angeboten oder gesperrt ist und wohin es führt, entscheidet der geteilte
   * Öffner (`detail-dialog-opener.spec.ts`) — der Dialog bekommt es mit.
   */
  describe('Bearbeiten statt Backend (#493)', () => {
    const knopf = (
      fixture: ComponentFixture<DataEntryDetailDialogComponent>,
      beschriftung: string,
    ) =>
      (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]).find(
        b => b.textContent!.trim() === beschriftung,
      );

    it('trägt keinen Weg mehr in die Django-Administration', async () => {
      const fixture = await render(baseEntry());
      const el = fixture.nativeElement as HTMLElement;

      expect(el.textContent).not.toContain('Backend');
      expect(el.textContent).not.toContain('Administration');
      // Auch nicht still als Verweis: kein Element zeigt auf /admin.
      const verweise = Array.from(el.querySelectorAll('a')).map(a => a.getAttribute('href') ?? '');
      expect(verweise.some(href => href.includes('admin'))).toBeFalse();
    });

    it('trägt einen „Bearbeiten"-Knopf', async () => {
      const fixture = await render(baseEntry());

      expect(knopf(fixture, 'Bearbeiten')).withContext('„Bearbeiten" vorhanden').toBeDefined();
    });

    // Der Knopf führt **hinaus** — er ändert nichts an Ort und Stelle. Der Dialog
    // schließt sich und überlässt das Wohin dem Öffner.
    it('führt aus dem Dialog hinaus, statt darin zu ändern', async () => {
      const fixture = await render(baseEntry());

      knopf(fixture, 'Bearbeiten')!.click();

      expect(bearbeiteFang).toHaveBeenCalledTimes(1);
      expect(dialogRef.close).toHaveBeenCalledTimes(1);
    });

    it('bleibt im Übrigen schreibgeschützt — kein Feld ist darin änderbar', async () => {
      const fixture = await render(baseEntry());
      const el = fixture.nativeElement as HTMLElement;

      expect(el.querySelectorAll('input, select, textarea, [contenteditable="true"]').length).toBe(
        0,
      );
      // Genau zwei Wege heraus, beide benannt: zumachen oder korrigieren.
      const beschriftungen = (
        Array.from(el.querySelectorAll('button')) as HTMLButtonElement[]
      ).map(b => b.textContent!.trim());
      expect(beschriftungen).toEqual(['Schließen', 'Bearbeiten']);
    });

    /**
     * Ein gesperrter Knopf bleibt **sichtbar** und **nennt den Grund** (ADR 0037:
     * nie ein verwehrter Weg ohne den Satz, der sagt warum und wann wieder). Er
     * trägt `aria-disabled` und **kein** blankes `disabled` — das überspränge ein
     * Screenreader, und die Begründung wäre für sie nie erreichbar (Lehre aus
     * #416/#417).
     */
    describe('gesperrt', () => {
      const GRUND = 'Ohne Verbindung nicht bearbeitbar.';

      async function gesperrtGerendert(): Promise<
        ComponentFixture<DataEntryDetailDialogComponent>
      > {
        angebot.set({ gesperrt: true, grund: GRUND });
        return render(baseEntry());
      }

      it('zeigt den Knopf weiter an, für Screenreader ausdrücklich als nicht auslösbar', async () => {
        const fixture = await gesperrtGerendert();

        const bearbeiten = knopf(fixture, 'Bearbeiten')!;
        expect(bearbeiten).withContext('sichtbar geblieben').toBeDefined();
        expect(bearbeiten.getAttribute('aria-disabled')).toBe('true');
        expect(bearbeiten.hasAttribute('disabled'))
          .withContext('kein blankes disabled — sonst überspringt der Screenreader ihn')
          .toBeFalse();
        expect(bearbeiten.tabIndex).withContext('bleibt anfokussierbar').toBe(0);
      });

      it('macht die Begründung für einen Screenreader erreichbar', async () => {
        const fixture = await gesperrtGerendert();
        const el = fixture.nativeElement as HTMLElement;

        const bearbeiten = knopf(fixture, 'Bearbeiten')!;
        const beschriebenVon = bearbeiten.getAttribute('aria-describedby');
        expect(beschriebenVon).withContext('der Knopf verweist auf seine Begründung').toBeTruthy();
        expect(el.querySelector(`#${beschriebenVon}`)!.textContent!.trim()).toBe(GRUND);
      });

      it('ist nicht auslösbar — ein Tipp führt nirgendwohin', async () => {
        const fixture = await gesperrtGerendert();

        knopf(fixture, 'Bearbeiten')!.click();

        expect(bearbeiteFang).not.toHaveBeenCalled();
        expect(dialogRef.close).not.toHaveBeenCalled();
      });

      // Die Sperre gilt der Reichweite des Geräts, nicht dem Alter des Fangs:
      // fällt sie, ist der Knopf im offenen Dialog sofort wieder auslösbar.
      it('wird wieder auslösbar, sobald die Sperre fällt', async () => {
        const fixture = await gesperrtGerendert();

        angebot.set({ gesperrt: false, grund: null });
        fixture.detectChanges();

        const bearbeiten = knopf(fixture, 'Bearbeiten')!;
        expect(bearbeiten.getAttribute('aria-disabled')).toBeNull();
        bearbeiten.click();
        expect(bearbeiteFang).toHaveBeenCalledTimes(1);
      });
    });
  });
});
