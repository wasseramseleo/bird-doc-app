import { computePlausibilityWarnings, SpeciesNorm } from './plausibility';

// The single source of truth for the Plausibilitätsprüfung (PRD #245, issue
// #246): a pure function used by both the inline hint and the save-time
// acknowledgment. This slice implements the Gewicht σ-band (Ø ± sd_factor·SD)
// with its optionality; #247/#248/#249 extend it to the other measurements, the
// Quotient and the categorical flags.

// A Zaunkönig-style Gewicht norm: Ø 9,1 g, SD 0,82 g, k 1,96 → band 7,5–10,7 g.
const zaunkoenigNorm: SpeciesNorm = {
  species_id: 's1',
  species_name: 'Zaunkönig',
  weight_mean: '9.1',
  weight_sd: '0.82',
  feather_mean: null,
  feather_sd: null,
  wing_mean: null,
  wing_sd: null,
  tarsus_mean: null,
  tarsus_sd: null,
  notch_f2_mean: null,
  notch_f2_sd: null,
  inner_foot_mean: null,
  inner_foot_sd: null,
  quotient_mean: null,
  quotient_tolerance_pct: null,
  sd_factor: '1.96',
  geschlechtsbestimmung_moeglich: null,
  dj_grossgefiedermauser_moeglich: null,
};

describe('computePlausibilityWarnings — Gewicht σ-band', () => {
  it('produces no warning for an in-range Gewicht', () => {
    const warnings = computePlausibilityWarnings({ weight_gram: 9.0 }, zaunkoenigNorm);
    expect(warnings).toEqual([]);
  });

  it('produces exactly one warning for an out-of-range Gewicht, with the de-AT message', () => {
    const warnings = computePlausibilityWarnings({ weight_gram: 25 }, zaunkoenigNorm);
    expect(warnings.length).toBe(1);
    expect(warnings[0].field).toBe('weight_gram');
    expect(warnings[0].message).toBe(
      'Gewicht 25 g liegt außerhalb des erwarteten Bereichs 7,5–10,7 g (Zaunkönig)',
    );
  });

  it('warns when the value is below the band too', () => {
    const warnings = computePlausibilityWarnings({ weight_gram: 3 }, zaunkoenigNorm);
    expect(warnings.length).toBe(1);
    expect(warnings[0].field).toBe('weight_gram');
  });

  it('treats the band edges as in range', () => {
    // low = 9.1 - 1.96*0.82 = 7.4928; high = 10.7072
    expect(computePlausibilityWarnings({ weight_gram: 7.4928 }, zaunkoenigNorm)).toEqual([]);
    expect(computePlausibilityWarnings({ weight_gram: 10.7072 }, zaunkoenigNorm)).toEqual([]);
  });

  it('produces no warning when there is no norm at all', () => {
    expect(computePlausibilityWarnings({ weight_gram: 25 }, null)).toEqual([]);
  });

  it('produces no warning when the Gewicht field is blank', () => {
    expect(computePlausibilityWarnings({ weight_gram: null }, zaunkoenigNorm)).toEqual([]);
    expect(computePlausibilityWarnings({ weight_gram: undefined }, zaunkoenigNorm)).toEqual([]);
    expect(computePlausibilityWarnings({}, zaunkoenigNorm)).toEqual([]);
  });

  it('produces no warning when the norm has no Gewicht band (that check is off)', () => {
    const noWeightBand: SpeciesNorm = { ...zaunkoenigNorm, weight_mean: null, weight_sd: null };
    expect(computePlausibilityWarnings({ weight_gram: 25 }, noWeightBand)).toEqual([]);
  });

  it('falls back to k = 1,96 when the norm carries no sd_factor', () => {
    const noFactor: SpeciesNorm = { ...zaunkoenigNorm, sd_factor: null };
    const warnings = computePlausibilityWarnings({ weight_gram: 25 }, noFactor);
    expect(warnings[0].message).toBe(
      'Gewicht 25 g liegt außerhalb des erwarteten Bereichs 7,5–10,7 g (Zaunkönig)',
    );
  });
});

// Issue #247: the remaining five σ-measurements. Each reuses the identical
// Ø ± sd_factor·SD band (the sigmaBandWarning helper) and per-field optionality
// — a warning fires only when that norm column pair is set AND the field has a
// value — and states value + expected range in de-AT (mm). A fully-normed
// Zaunkönig (all six bands set, k = 1,96) exercises them one at a time: with a
// single measurement filled, the other five stay blank and never fire, so a
// single out-of-range value yields exactly one warning.
describe('computePlausibilityWarnings — the five additional σ-measurements (#247)', () => {
  const fullNorm: SpeciesNorm = {
    ...zaunkoenigNorm,
    feather_mean: '54',
    feather_sd: '2',
    wing_mean: '73',
    wing_sd: '2.5',
    tarsus_mean: '19',
    tarsus_sd: '0.6',
    notch_f2_mean: '8',
    notch_f2_sd: '0.7',
    inner_foot_mean: '15',
    inner_foot_sd: '0.8',
    // Silence the Gewicht band so these cases isolate their own measurement.
    weight_mean: null,
    weight_sd: null,
  };

  interface Case {
    label: string;
    field: 'feather_span' | 'wing_span' | 'tarsus' | 'notch_f2' | 'inner_foot';
    meanKey: keyof SpeciesNorm;
    sdKey: keyof SpeciesNorm;
    inRange: number;
    outOfRange: number;
    message: string;
  }

  const cases: Case[] = [
    {
      label: 'Federlänge',
      field: 'feather_span',
      meanKey: 'feather_mean',
      sdKey: 'feather_sd',
      inRange: 54,
      outOfRange: 65,
      message:
        'Federlänge 65 mm liegt außerhalb des erwarteten Bereichs 50,1–57,9 mm (Zaunkönig)',
    },
    {
      label: 'Flügellänge',
      field: 'wing_span',
      meanKey: 'wing_mean',
      sdKey: 'wing_sd',
      inRange: 73,
      outOfRange: 90,
      message:
        'Flügellänge 90 mm liegt außerhalb des erwarteten Bereichs 68,1–77,9 mm (Zaunkönig)',
    },
    {
      label: 'Tarsus',
      field: 'tarsus',
      meanKey: 'tarsus_mean',
      sdKey: 'tarsus_sd',
      inRange: 19,
      outOfRange: 25,
      message: 'Tarsus 25 mm liegt außerhalb des erwarteten Bereichs 17,8–20,2 mm (Zaunkönig)',
    },
    {
      label: 'Kerbe F2',
      field: 'notch_f2',
      meanKey: 'notch_f2_mean',
      sdKey: 'notch_f2_sd',
      inRange: 8,
      outOfRange: 12,
      message: 'Kerbe F2 12 mm liegt außerhalb des erwarteten Bereichs 6,6–9,4 mm (Zaunkönig)',
    },
    {
      label: 'Innenfuß',
      field: 'inner_foot',
      meanKey: 'inner_foot_mean',
      sdKey: 'inner_foot_sd',
      inRange: 15,
      outOfRange: 20,
      message: 'Innenfuß 20 mm liegt außerhalb des erwarteten Bereichs 13,4–16,6 mm (Zaunkönig)',
    },
  ];

  for (const c of cases) {
    describe(c.label, () => {
      it('produces no warning for an in-range value', () => {
        expect(computePlausibilityWarnings({ [c.field]: c.inRange }, fullNorm)).toEqual([]);
      });

      it('produces exactly one warning for an out-of-range value, with the de-AT message', () => {
        const warnings = computePlausibilityWarnings({ [c.field]: c.outOfRange }, fullNorm);
        expect(warnings.length).toBe(1);
        expect(warnings[0].field).toBe(c.field);
        expect(warnings[0].message).toBe(c.message);
      });

      it('produces no warning when the norm has no band for it (that check is off)', () => {
        const noBand: SpeciesNorm = { ...fullNorm, [c.meanKey]: null, [c.sdKey]: null };
        expect(computePlausibilityWarnings({ [c.field]: c.outOfRange }, noBand)).toEqual([]);
      });

      it('produces no warning when the field is blank', () => {
        expect(computePlausibilityWarnings({ [c.field]: null }, fullNorm)).toEqual([]);
        expect(computePlausibilityWarnings({ [c.field]: undefined }, fullNorm)).toEqual([]);
        expect(computePlausibilityWarnings({}, fullNorm)).toEqual([]);
      });
    });
  }

  it('aggregates a warning per out-of-range measurement across all six bands', () => {
    // All six bands set (Gewicht too), every field out of range → one warning
    // each, in a single flat list — the source the save-time dialog aggregates.
    const allBands: SpeciesNorm = { ...fullNorm, weight_mean: '9.1', weight_sd: '0.82' };
    const warnings = computePlausibilityWarnings(
      {
        weight_gram: 25,
        feather_span: 65,
        wing_span: 90,
        tarsus: 25,
        notch_f2: 12,
        inner_foot: 20,
      },
      allBands,
    );
    expect(warnings.map((w) => w.field)).toEqual([
      'weight_gram',
      'feather_span',
      'wing_span',
      'tarsus',
      'notch_f2',
      'inner_foot',
    ]);
  });
});
