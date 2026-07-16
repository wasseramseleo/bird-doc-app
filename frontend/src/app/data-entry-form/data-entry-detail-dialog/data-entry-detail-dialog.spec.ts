import { LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { registerLocaleData } from '@angular/common';
import localeDeAt from '@angular/common/locales/de-AT';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { DataEntryDetailDialogComponent } from './data-entry-detail-dialog';
import { AgeClass, BirdStatus, DataEntry, Sex } from '../../models/data-entry.model';
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

  async function render(entry: DataEntry): Promise<ComponentFixture<DataEntryDetailDialogComponent>> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [DataEntryDetailDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: LOCALE_ID, useValue: 'de-AT' },
        { provide: MAT_DIALOG_DATA, useValue: entry },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(DataEntryDetailDialogComponent);
    fixture.detectChanges();
    return fixture;
  }

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
});
