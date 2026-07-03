import { computePlausibilityWarnings, SpeciesNorm } from './plausibility';
import {
  computePlausibilitySignatures,
  reconcileAcknowledgedWarnings,
  resetAcknowledgedSignatures,
  AcknowledgedSignatures,
} from './plausibility-acknowledgment';
import { AgeClass, HandWingMoult, Sex } from '../../models/data-entry.model';

// PRD #261, issue #264: the pure „fire once, never nag" Quittierungslogik that
// sits BESIDE the Plausibilitätsprüfung (plausibility.ts) and decides which
// currently-active Plausibilitätswarnungen are *newly appeared* (→ raise a modal)
// versus already acknowledged (→ stay silent). It consumes the warnings
// computePlausibilityWarnings already produces plus a per-field acknowledged
// SIGNATURE, and — like plausibility.ts — is a pure function unit-tested in
// isolation. This spec mirrors plausibility.spec.ts and covers each acceptance
// criterion of #264.

// A fully-normed Zaunkönig (all six σ bands, the Quotient and both categorical
// flags armed, k = 1,96) so any measurement can be pushed out of range and its
// real warning + signature exercised end-to-end via the two pure functions the
// component actually composes.
const zaunkoenigNorm: SpeciesNorm = {
  species_id: 's1',
  species_name: 'Zaunkönig',
  weight_mean: '9.1',
  weight_sd: '0.82',
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
  quotient_mean: '0.74',
  quotient_tolerance_pct: '3',
  sd_factor: '1.96',
  geschlechtsbestimmung_moeglich: false,
  dj_grossgefiedermauser_moeglich: false,
};

// The real usage seam the component drives: compute the active warnings and the
// current per-field signatures from one measurement snapshot, then reconcile them
// against what was last acknowledged. Returning both keeps every test faithful to
// "consumes the warnings computePlausibilityWarnings produces".
function evaluate(
  measurements: Parameters<typeof computePlausibilitySignatures>[0],
  previousAcknowledged: AcknowledgedSignatures,
) {
  const warnings = computePlausibilityWarnings(measurements, zaunkoenigNorm);
  const signatures = computePlausibilitySignatures(measurements);
  return reconcileAcknowledgedWarnings(previousAcknowledged, warnings, signatures);
}

describe('computePlausibilitySignatures — per-field acknowledged signature rules', () => {
  it('gives each σ-band field a signature equal to that field\'s value', () => {
    const a = computePlausibilitySignatures({ weight_gram: 25 });
    const b = computePlausibilitySignatures({ weight_gram: 25 });
    const c = computePlausibilitySignatures({ weight_gram: 30 });
    // Same value → same signature; a different value → a different signature.
    expect(a['weight_gram']).toBe(b['weight_gram']);
    expect(a['weight_gram']).not.toBe(c['weight_gram']);
  });

  it('treats each of the six σ measurements as its own independent signature', () => {
    const fields = ['weight_gram', 'feather_span', 'wing_span', 'tarsus', 'notch_f2', 'inner_foot'];
    for (const field of fields) {
      const same = computePlausibilitySignatures({ [field]: 12 });
      const diff = computePlausibilitySignatures({ [field]: 13 });
      expect(same[field]).toBe(computePlausibilitySignatures({ [field]: 12 })[field]);
      expect(same[field]).not.toBe(diff[field]);
    }
  });

  it('coerces a numeric string and a number of equal value to the same signature', () => {
    // A DecimalField rides the wire as a string; the form control holds a number.
    // The same measured value must not re-fire just because its type changed.
    const asString = computePlausibilitySignatures({ weight_gram: '25' });
    const asNumber = computePlausibilitySignatures({ weight_gram: 25 });
    expect(asString['weight_gram']).toBe(asNumber['weight_gram']);
  });

  it('keys the derived quotient signature off the (feather_span, wing_span) pair', () => {
    const base = computePlausibilitySignatures({ feather_span: 54, wing_span: 73 });
    const sameQuotient = computePlausibilitySignatures({ feather_span: 54, wing_span: 73 });
    const changedFeather = computePlausibilitySignatures({ feather_span: 60, wing_span: 73 });
    const changedWing = computePlausibilitySignatures({ feather_span: 54, wing_span: 70 });
    expect(base['quotient']).toBe(sameQuotient['quotient']);
    // Either operand moving changes the pair signature.
    expect(base['quotient']).not.toBe(changedFeather['quotient']);
    expect(base['quotient']).not.toBe(changedWing['quotient']);
  });

  it('keys the sex signature off sex alone', () => {
    const male = computePlausibilitySignatures({ sex: Sex.Male });
    const maleAgain = computePlausibilitySignatures({ sex: Sex.Male });
    const female = computePlausibilitySignatures({ sex: Sex.Female });
    expect(male['sex']).toBe(maleAgain['sex']);
    expect(male['sex']).not.toBe(female['sex']);
  });

  it('keys the hand_wing signature off the (age_class, hand_wing) pair', () => {
    const base = computePlausibilitySignatures({
      age_class: AgeClass.ThisYear,
      hand_wing: HandWingMoult.AtLeastOne,
    });
    const same = computePlausibilitySignatures({
      age_class: AgeClass.ThisYear,
      hand_wing: HandWingMoult.AtLeastOne,
    });
    const changedAge = computePlausibilitySignatures({
      age_class: AgeClass.NotThisYear,
      hand_wing: HandWingMoult.AtLeastOne,
    });
    const changedMoult = computePlausibilitySignatures({
      age_class: AgeClass.ThisYear,
      hand_wing: HandWingMoult.All,
    });
    expect(base['hand_wing']).toBe(same['hand_wing']);
    // Either the Alter or the Handschwingenmauser moving changes the pair.
    expect(base['hand_wing']).not.toBe(changedAge['hand_wing']);
    expect(base['hand_wing']).not.toBe(changedMoult['hand_wing']);
  });
});

describe('reconcileAcknowledgedWarnings — „fire once, never nag" de-duplication', () => {
  it('reports a currently-active warning whose signature differs from its last-acknowledged one as newly-appeared', () => {
    // Nothing acknowledged yet: an out-of-range Gewicht is new → shown.
    const result = evaluate({ weight_gram: 25 }, {});
    expect(result.toShow.map((w) => w.field)).toEqual(['weight_gram']);
    // Its signature is recorded so it can be carried into the next evaluation.
    const signatures = computePlausibilitySignatures({ weight_gram: 25 });
    expect(result.nextAcknowledged['weight_gram']).toBe(signatures['weight_gram']);
  });

  it('suppresses a warning whose signature is unchanged since acknowledgment', () => {
    // First evaluation acknowledges the Gewicht discrepancy…
    const first = evaluate({ weight_gram: 25 }, {});
    // …re-evaluating the SAME value (e.g. tabbing back through the field) is silent.
    const second = evaluate({ weight_gram: 25 }, first.nextAcknowledged);
    expect(second.toShow).toEqual([]);
    // But it stays acknowledged (still out of range → carried forward, not cleared).
    expect(second.nextAcknowledged['weight_gram']).toBe(first.nextAcknowledged['weight_gram']);
  });

  it('re-fires when the value changes to a new out-of-range value (signature changed)', () => {
    const first = evaluate({ weight_gram: 25 }, {});
    // Correct it to a *different* still-implausible value → a fresh check fires.
    const second = evaluate({ weight_gram: 30 }, first.nextAcknowledged);
    expect(second.toShow.map((w) => w.field)).toEqual(['weight_gram']);
    expect(second.nextAcknowledged['weight_gram']).not.toBe(first.nextAcknowledged['weight_gram']);
  });

  it('clears a field\'s acknowledged signature when it returns in range', () => {
    const acknowledged = evaluate({ weight_gram: 25 }, {}).nextAcknowledged;
    // Bring the Gewicht back into range: no modal, and the signature is cleared.
    const inRange = evaluate({ weight_gram: 9 }, acknowledged);
    expect(inRange.toShow).toEqual([]);
    expect('weight_gram' in inRange.nextAcknowledged).toBe(false);
  });

  it('re-fires a later re-breach with the SAME value because returning in range cleared the signature', () => {
    const acknowledged = evaluate({ weight_gram: 25 }, {}).nextAcknowledged;
    const cleared = evaluate({ weight_gram: 9 }, acknowledged).nextAcknowledged;
    // Back out of range at the very same 25 g that was once acknowledged → fires
    // again, because the in-range visit wiped its acknowledged signature.
    const reBreach = evaluate({ weight_gram: 25 }, cleared);
    expect(reBreach.toShow.map((w) => w.field)).toEqual(['weight_gram']);
  });

  it('aggregates several newly-appeared warnings from one evaluation into one toShow set', () => {
    // A single snapshot breaching six independent checks at once → every warning
    // appears once, together, in field order — one aggregated set, no stacking.
    const result = evaluate(
      {
        weight_gram: 25,
        tarsus: 30,
        sex: Sex.Male,
        age_class: AgeClass.ThisYear,
        hand_wing: HandWingMoult.AtLeastOne,
        // A feather/wing pair each INSIDE its own σ band (Federlänge 50,1–57,9;
        // Flügellänge 68,1–77,9) whose ratio 0,81 nonetheless trips the Quotient
        // band, so the sole extra warning here is the derived quotient one.
        feather_span: 57,
        wing_span: 70,
      },
      {},
    );
    expect(result.toShow.map((w) => w.field)).toEqual([
      'weight_gram',
      'tarsus',
      'quotient',
      'sex',
      'hand_wing',
    ]);
  });

  it('shows only the genuinely new warning when another is already acknowledged (never nag)', () => {
    // Acknowledge an out-of-range Gewicht first.
    const acknowledged = evaluate({ weight_gram: 25 }, {}).nextAcknowledged;
    // Now a Tarsus also goes out of range while the Gewicht is unchanged: only the
    // Tarsus is new — the already-acknowledged Gewicht must not nag.
    const result = evaluate({ weight_gram: 25, tarsus: 30 }, acknowledged);
    expect(result.toShow.map((w) => w.field)).toEqual(['tarsus']);
    // Both remain acknowledged afterwards.
    expect('weight_gram' in result.nextAcknowledged).toBe(true);
    expect('tarsus' in result.nextAcknowledged).toBe(true);
  });
});

describe('resetAcknowledgedSignatures — the Art-change „reset all" path', () => {
  it('clears every acknowledged signature', () => {
    const acknowledged = evaluate({ weight_gram: 25, tarsus: 30 }, {}).nextAcknowledged;
    expect(Object.keys(acknowledged).length).toBeGreaterThan(0);
    expect(resetAcknowledgedSignatures()).toEqual({});
  });

  it('makes a still-active warning re-fire after the Art changes (Artennorm re-evaluated)', () => {
    // The Gewicht was acknowledged under the old Art…
    const acknowledged = evaluate({ weight_gram: 25 }, {}).nextAcknowledged;
    // …switching Art clears all signatures, so the still-implausible value fires
    // again against the new Artennorm rather than staying silently acknowledged.
    const afterArtChange = evaluate({ weight_gram: 25 }, resetAcknowledgedSignatures());
    expect(afterArtChange.toShow.map((w) => w.field)).toEqual(['weight_gram']);
    // Sanity: it really had been acknowledged before the reset.
    expect('weight_gram' in acknowledged).toBe(true);
  });

  it('returns a fresh object each call (no shared mutable reset state)', () => {
    const a = resetAcknowledgedSignatures();
    a['weight_gram'] = 'poisoned';
    expect(resetAcknowledgedSignatures()).toEqual({});
  });
});
