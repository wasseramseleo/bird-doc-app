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
