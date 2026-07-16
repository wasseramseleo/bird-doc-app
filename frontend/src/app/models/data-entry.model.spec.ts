import { Parasit, PARASIT_LABELS, PARASIT_OPTIONS } from './data-entry.model';

// Parasit vocabulary (issue #406). The Mehrfachauswahl renders PARASIT_OPTIONS
// directly, so these are the options the Beringer actually sees — order included.
// The vocabulary is mirrored BY HAND in the backend's DataEntry.Parasit enum, and
// both consumers fall back to the raw code for anything unknown, so a drift here
// fails nowhere and surfaces as a literal `white_mites` in the official Meldung.
describe('Parasit vocabulary (issue #406)', () => {
  it('offers exactly the five parasite types, in the agreed order', () => {
    expect(PARASIT_OPTIONS.map(option => option.value)).toEqual([
      Parasit.RedMites,
      Parasit.WhiteMites,
      Parasit.Tick,
      Parasit.FeatherLice,
      Parasit.LouseFly,
    ]);
    expect(PARASIT_OPTIONS.map(option => option.viewValue)).toEqual([
      'Rote Milben',
      'Weiße Milben',
      'Zecke',
      'Federlinge',
      'Lausfliege',
    ]);
  });

  it('carries the exact codes the backend vocabulary uses', () => {
    // Mirrors backend/birds/models.py :: DataEntry.Parasit — same codes, same order.
    expect(PARASIT_OPTIONS.map(option => option.value as string)).toEqual([
      'red_mites',
      'white_mites',
      'tick',
      'feather_lice',
      'louse_fly',
    ]);
  });

  it('no longer offers the retired „Milben" option', () => {
    // `mites` stays writable server-side for the offline window (ADR 0031), but it
    // must never be offered again — an old code the UI still hands out would never
    // stop being written.
    expect(PARASIT_OPTIONS.map(option => option.value as string)).not.toContain('mites');
    expect(PARASIT_OPTIONS.map(option => option.viewValue)).not.toContain('Milben');
    expect(Object.values(Parasit) as string[]).not.toContain('mites');
  });

  it('labels every option it offers', () => {
    for (const option of PARASIT_OPTIONS) {
      expect(PARASIT_LABELS[option.value]).toBe(option.viewValue);
    }
  });
});
