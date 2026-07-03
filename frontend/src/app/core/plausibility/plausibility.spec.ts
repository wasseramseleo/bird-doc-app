import { computePlausibilityWarnings, SpeciesNorm } from './plausibility';
import { AgeClass, HandWingMoult, Sex } from '../../models/data-entry.model';

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

// Issue #248: the Quotient rule. Federlänge/Flügellänge (feather_span/wing_span,
// derived — no stored field) is tested against a RELATIVE band
// quotient_mean ± quotient_tolerance_pct (default 3 %), not a σ band. It fires
// only when the quotient norm is set AND BOTH operands are present — a blank
// Federlänge or Flügellänge suppresses it — and is independent of whether the
// σ rules for Federlänge/Flügellänge exist. The message names the computed
// quotient and the expected band in de-AT (a dimensionless ratio, two decimals).
describe('computePlausibilityWarnings — Quotient (relative band, #248)', () => {
  // A Zaunkönig-style quotient norm: Ø 0,74, Toleranz 3 % → band 0,72–0,76.
  // Only the quotient rule is set; the six σ bands are off so a Quotient case
  // yields at most the one quotient warning.
  const quotientNorm: SpeciesNorm = {
    ...zaunkoenigNorm,
    weight_mean: null,
    weight_sd: null,
    quotient_mean: '0.74',
    quotient_tolerance_pct: '3',
  };

  it('produces no warning for an in-band quotient', () => {
    // 54/73 = 0,7397 — inside 0,72–0,76.
    expect(
      computePlausibilityWarnings({ feather_span: 54, wing_span: 73 }, quotientNorm),
    ).toEqual([]);
  });

  it('produces exactly one warning for an out-of-band quotient, with the de-AT message', () => {
    // 60/70 = 0,857 — above the band; names the computed quotient and the band.
    const warnings = computePlausibilityWarnings(
      { feather_span: 60, wing_span: 70 },
      quotientNorm,
    );
    expect(warnings.length).toBe(1);
    expect(warnings[0].field).toBe('quotient');
    expect(warnings[0].message).toBe(
      'Quotient Federlänge/Flügellänge 0,86 liegt außerhalb des erwarteten Bereichs 0,72–0,76 (Zaunkönig)',
    );
  });

  it('warns when the quotient is below the band too', () => {
    // 50/75 = 0,6667 — below the band.
    const warnings = computePlausibilityWarnings(
      { feather_span: 50, wing_span: 75 },
      quotientNorm,
    );
    expect(warnings.length).toBe(1);
    expect(warnings[0].field).toBe('quotient');
    expect(warnings[0].message).toBe(
      'Quotient Federlänge/Flügellänge 0,67 liegt außerhalb des erwarteten Bereichs 0,72–0,76 (Zaunkönig)',
    );
  });

  it('produces no warning when the quotient norm is unset (that check is off)', () => {
    const noQuotient: SpeciesNorm = { ...quotientNorm, quotient_mean: null };
    expect(
      computePlausibilityWarnings({ feather_span: 60, wing_span: 70 }, noQuotient),
    ).toEqual([]);
  });

  it('produces no warning when either operand is blank (needs both)', () => {
    // Federlänge blank.
    expect(computePlausibilityWarnings({ wing_span: 70 }, quotientNorm)).toEqual([]);
    expect(
      computePlausibilityWarnings({ feather_span: null, wing_span: 70 }, quotientNorm),
    ).toEqual([]);
    // Flügellänge blank.
    expect(computePlausibilityWarnings({ feather_span: 60 }, quotientNorm)).toEqual([]);
    expect(
      computePlausibilityWarnings({ feather_span: 60, wing_span: undefined }, quotientNorm),
    ).toEqual([]);
    // Both blank.
    expect(computePlausibilityWarnings({}, quotientNorm)).toEqual([]);
  });

  it('falls back to a 3 % tolerance when the norm carries no quotient_tolerance_pct', () => {
    const noTolerance: SpeciesNorm = { ...quotientNorm, quotient_tolerance_pct: null };
    // Still band 0,72–0,76; 60/70 = 0,857 is out, 54/73 = 0,7397 is in.
    expect(
      computePlausibilityWarnings({ feather_span: 54, wing_span: 73 }, noTolerance),
    ).toEqual([]);
    const warnings = computePlausibilityWarnings(
      { feather_span: 60, wing_span: 70 },
      noTolerance,
    );
    expect(warnings.length).toBe(1);
    expect(warnings[0].message).toBe(
      'Quotient Federlänge/Flügellänge 0,86 liegt außerhalb des erwarteten Bereichs 0,72–0,76 (Zaunkönig)',
    );
  });

  it('fires independently of the σ rules for Federlänge/Flügellänge', () => {
    // The σ bands stay OFF (null) yet the quotient still fires — the rule reads
    // the two measurement fields directly, it does not depend on those bands.
    expect(quotientNorm.feather_mean).toBeNull();
    expect(quotientNorm.wing_mean).toBeNull();
    const warnings = computePlausibilityWarnings(
      { feather_span: 60, wing_span: 70 },
      quotientNorm,
    );
    expect(warnings.map((w) => w.field)).toEqual(['quotient']);
  });
});

// Issue #249: the categorical Geschlechtsbestimmung flag. When the effective
// norm says the sex cannot be told apart for the species
// (geschlechtsbestimmung_moeglich === false) yet the Beringer recorded a
// *determined* Geschlecht (Männchen/Weibchen), warn — the rule fires on a claim,
// not an absence, so Unbekannt never warns. A null flag switches the check off.
describe('computePlausibilityWarnings — Geschlechtsbestimmung flag (#249)', () => {
  // Only the flag rule is armed; the six σ bands and the Quotient are off so a
  // sex case yields at most the one flag warning.
  const notSexableNorm: SpeciesNorm = {
    ...zaunkoenigNorm,
    weight_mean: null,
    weight_sd: null,
    geschlechtsbestimmung_moeglich: false,
  };

  it('warns for a determined Männchen with the de-AT message', () => {
    const warnings = computePlausibilityWarnings({ sex: Sex.Male }, notSexableNorm);
    expect(warnings.length).toBe(1);
    expect(warnings[0].field).toBe('sex');
    expect(warnings[0].message).toBe(
      'Geschlechtsbestimmung laut Artennorm nicht möglich (Zaunkönig)',
    );
  });

  it('warns for a determined Weibchen too', () => {
    const warnings = computePlausibilityWarnings({ sex: Sex.Female }, notSexableNorm);
    expect(warnings.length).toBe(1);
    expect(warnings[0].field).toBe('sex');
  });

  it('produces no warning for Unbekannt (fires on a claim, not an absence)', () => {
    expect(computePlausibilityWarnings({ sex: Sex.Unknown }, notSexableNorm)).toEqual([]);
  });

  it('produces no warning when the sex is blank', () => {
    expect(computePlausibilityWarnings({ sex: null }, notSexableNorm)).toEqual([]);
    expect(computePlausibilityWarnings({ sex: undefined }, notSexableNorm)).toEqual([]);
    expect(computePlausibilityWarnings({}, notSexableNorm)).toEqual([]);
  });

  it('produces no warning when the flag is unset (null → check off)', () => {
    const flagUnset: SpeciesNorm = { ...notSexableNorm, geschlechtsbestimmung_moeglich: null };
    expect(computePlausibilityWarnings({ sex: Sex.Male }, flagUnset)).toEqual([]);
  });

  it('produces no warning when the flag is true (sexing IS possible)', () => {
    const sexable: SpeciesNorm = { ...notSexableNorm, geschlechtsbestimmung_moeglich: true };
    expect(computePlausibilityWarnings({ sex: Sex.Male }, sexable)).toEqual([]);
  });
});

// Issue #249: the categorical dj-Großgefiedermauser flag. When the effective
// norm says a diesjähriger (first-year) Vogel of this species does NOT moult its
// Großgefieder (dj_grossgefiedermauser_moeglich === false), the bird is
// diesjährig (Alter = 3) AND its Handschwingenmauser value indicates a moult is
// present, warn. Not diesjährig → none; a blank or a "no moult" Handschwingen-
// value → none; a null flag switches the check off.
describe('computePlausibilityWarnings — dj-Großgefiedermauser flag (#249)', () => {
  // The HandWingMoult values that count as "Handschwingenmauser vorhanden" (an
  // active or completed Großgefiedermauser). DERIVED from the enum as the
  // complement of the two "no moult" states —
  //   None    (0, "keine Handschwingen wachsen")
  //   NoneOld (1, "alle sind unvermausert")
  // — so the "vorhanden" set is everything else:
  //   AtLeastOne (2, "mindestens eine mausert")
  //   All        (3, "alle vermausert")
  //   Part       (4, "ein Teil ist vermausert")
  const HAND_WING_NO_MOULT: HandWingMoult[] = [HandWingMoult.None, HandWingMoult.NoneOld];
  const HAND_WING_MOULT_PRESENT: HandWingMoult[] = [
    HandWingMoult.AtLeastOne,
    HandWingMoult.All,
    HandWingMoult.Part,
  ];

  it('documents the "vorhanden" set as the enum complement of the no-moult states', () => {
    // Read the enum itself: its numeric members minus the two no-moult states
    // must equal the documented "vorhanden" set — proving it is derived, not a
    // hand-picked literal that could drift as the enum grows.
    const allNumericValues = Object.values(HandWingMoult).filter(
      (v): v is number => typeof v === 'number',
    );
    const derivedPresent = allNumericValues.filter((v) => !HAND_WING_NO_MOULT.includes(v));
    expect([...derivedPresent].sort()).toEqual([...HAND_WING_MOULT_PRESENT].sort());
  });

  // Only the flag rule is armed; the σ bands and the Quotient are off.
  const noDjMoultNorm: SpeciesNorm = {
    ...zaunkoenigNorm,
    weight_mean: null,
    weight_sd: null,
    dj_grossgefiedermauser_moeglich: false,
  };

  for (const value of HAND_WING_MOULT_PRESENT) {
    it(`warns for a diesjähriger Vogel with Handschwingenmauser ${value} (vorhanden)`, () => {
      const warnings = computePlausibilityWarnings(
        { age_class: AgeClass.ThisYear, hand_wing: value },
        noDjMoultNorm,
      );
      expect(warnings.length).toBe(1);
      expect(warnings[0].field).toBe('hand_wing');
      expect(warnings[0].message).toBe(
        'Großgefiedermauser bei diesjährigem Vogel laut Artennorm nicht zu erwarten (Zaunkönig)',
      );
    });
  }

  for (const value of HAND_WING_NO_MOULT) {
    it(`produces no warning for a "no moult" Handschwingen value ${value}`, () => {
      expect(
        computePlausibilityWarnings(
          { age_class: AgeClass.ThisYear, hand_wing: value },
          noDjMoultNorm,
        ),
      ).toEqual([]);
    });
  }

  it('produces no warning when the Handschwingenmauser value is blank', () => {
    expect(
      computePlausibilityWarnings({ age_class: AgeClass.ThisYear, hand_wing: null }, noDjMoultNorm),
    ).toEqual([]);
    expect(
      computePlausibilityWarnings(
        { age_class: AgeClass.ThisYear, hand_wing: undefined },
        noDjMoultNorm,
      ),
    ).toEqual([]);
    expect(computePlausibilityWarnings({ age_class: AgeClass.ThisYear }, noDjMoultNorm)).toEqual([]);
  });

  it('produces no warning when the bird is not diesjährig (age class ≠ 3)', () => {
    expect(
      computePlausibilityWarnings(
        { age_class: AgeClass.NotThisYear, hand_wing: HandWingMoult.AtLeastOne },
        noDjMoultNorm,
      ),
    ).toEqual([]);
    // Alter unset → not diesjährig either.
    expect(
      computePlausibilityWarnings({ hand_wing: HandWingMoult.AtLeastOne }, noDjMoultNorm),
    ).toEqual([]);
  });

  it('produces no warning when the flag is unset (null → check off)', () => {
    const flagUnset: SpeciesNorm = { ...noDjMoultNorm, dj_grossgefiedermauser_moeglich: null };
    expect(
      computePlausibilityWarnings(
        { age_class: AgeClass.ThisYear, hand_wing: HandWingMoult.AtLeastOne },
        flagUnset,
      ),
    ).toEqual([]);
  });

  it('produces no warning when the flag is true (dj-moult IS possible)', () => {
    const possible: SpeciesNorm = { ...noDjMoultNorm, dj_grossgefiedermauser_moeglich: true };
    expect(
      computePlausibilityWarnings(
        { age_class: AgeClass.ThisYear, hand_wing: HandWingMoult.AtLeastOne },
        possible,
      ),
    ).toEqual([]);
  });
});

// Issue #249: both categorical flags surface alongside the numeric warnings in a
// single flat list — the source the aggregated save-time dialog lists — trailing
// the σ measurements and the Quotient in field order.
describe('computePlausibilityWarnings — categorical flags aggregate with the numeric ones (#249)', () => {
  it('appends sex then hand_wing after the measurement warnings', () => {
    const allRulesNorm: SpeciesNorm = {
      ...zaunkoenigNorm,
      weight_mean: '9.1',
      weight_sd: '0.82',
      geschlechtsbestimmung_moeglich: false,
      dj_grossgefiedermauser_moeglich: false,
    };
    const warnings = computePlausibilityWarnings(
      {
        weight_gram: 25,
        sex: Sex.Male,
        age_class: AgeClass.ThisYear,
        hand_wing: HandWingMoult.AtLeastOne,
      },
      allRulesNorm,
    );
    expect(warnings.map((w) => w.field)).toEqual(['weight_gram', 'sex', 'hand_wing']);
  });
});
