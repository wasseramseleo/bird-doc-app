/**
 * The pure „fire once, never nag" Plausibilitäts-Quittierungslogik (PRD #261,
 * issue #264) that sits BESIDE the Plausibilitätsprüfung (`plausibility.ts`).
 *
 * Where `computePlausibilityWarnings` is the single source of truth for WHICH
 * measurements currently breach their Artennorm, this module decides which of
 * those active Plausibilitätswarnungen are *newly appeared* (and so should raise
 * the „Verstanden" modal) versus already acknowledged (and so must stay silent).
 * Like `plausibility.ts` it is a framework-free pure function the component
 * consumes and unit-tests in isolation — it holds no Angular/DOM dependency and
 * runs no Ausreißertest itself, it only consumes the warnings the Prüfung emits.
 *
 * De-duplication rides a per-field **acknowledged signature**: a warning is
 * „new" iff it is currently active AND its signature differs from the one last
 * acknowledged. A field returning in-range drops out of the acknowledged set (so
 * a later re-breach with the same value fires again), and an Art change wipes the
 * whole set (the Artennorm changed → re-evaluate everything). The signature rules
 * are per PRD #261:
 *
 * - σ-band fields (`weight_gram`, `feather_span`, `wing_span`, `tarsus`,
 *   `notch_f2`, `inner_foot`): signature = that field's value.
 * - `quotient` (derived): signature = the `(feather_span, wing_span)` pair.
 * - `sex`: signature = `sex`. `hand_wing`: signature = `(age_class, hand_wing)`.
 */

import { PlausibilityMeasurements, PlausibilityWarning } from './plausibility';

/**
 * The acknowledged (or currently-active) signatures, keyed by the SAME field
 * name a PlausibilityWarning carries (`weight_gram` … `quotient`, `sex`,
 * `hand_wing`). Each value is a canonical serialisation of that field's
 * signature, so equality is a plain string compare regardless of whether the
 * signature is a single value or a pair.
 */
export type AcknowledgedSignatures = Record<string, string>;

/** The outcome of one reconciliation step. */
export interface AcknowledgmentResult {
  /** The newly-appeared warnings to raise (active AND signature changed). */
  toShow: PlausibilityWarning[];
  /**
   * The acknowledged set AFTER this step: every currently-active warning's field
   * carries its current signature (so it stays silent until it changes), and any
   * field no longer breaching has dropped out (in-range clears it).
   */
  nextAcknowledged: AcknowledgedSignatures;
}

// A DecimalField rides the wire as a string while a form control holds a number,
// so the same measured value must yield the same signature either way. Mirrors
// plausibility.ts' own coercion (kept a private copy here so that module stays
// untouched): null/''/undefined and non-finite values collapse to null.
type Numeric = number | string | null | undefined;

function toNumber(value: Numeric): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

// A single σ-measurement's signature: its coerced value. JSON so `null`
// (blank/non-numeric) is a distinct, comparable token from any number.
function numericSignature(value: Numeric): string {
  return JSON.stringify(toNumber(value));
}

// A categorical select's signature: its raw code, or null when unset.
function categoricalSignature(value: number | null | undefined): string {
  return JSON.stringify(value ?? null);
}

/**
 * Build the per-field acknowledged-signature map for one measurement snapshot,
 * per the PRD #261 rules above. Produces a signature for every warnable field so
 * the reducer can look up any warning's field; the values of fields that are not
 * currently breaching are simply never read.
 */
export function computePlausibilitySignatures(
  measurements: PlausibilityMeasurements,
): AcknowledgedSignatures {
  return {
    // σ-band fields: signature = that field's value.
    weight_gram: numericSignature(measurements.weight_gram),
    feather_span: numericSignature(measurements.feather_span),
    wing_span: numericSignature(measurements.wing_span),
    tarsus: numericSignature(measurements.tarsus),
    notch_f2: numericSignature(measurements.notch_f2),
    inner_foot: numericSignature(measurements.inner_foot),
    // The derived Quotient has no field of its own: signature = the
    // (feather_span, wing_span) pair that produces it.
    quotient: JSON.stringify([
      toNumber(measurements.feather_span),
      toNumber(measurements.wing_span),
    ]),
    // Categorical flags.
    sex: categoricalSignature(measurements.sex),
    // hand_wing's rule reads both Alter and Handschwingenmauser, so its signature
    // is the (age_class, hand_wing) pair.
    hand_wing: JSON.stringify([measurements.age_class ?? null, measurements.hand_wing ?? null]),
  };
}

/**
 * Reconcile the currently-active warnings against what was last acknowledged.
 * A warning is reported in `toShow` iff its current signature differs from its
 * last-acknowledged one; `nextAcknowledged` records the current signature of
 * every active warning (so shown ones become acknowledged and unchanged ones
 * stay acknowledged) while any field no longer active drops out — an in-range
 * field clears its acknowledged signature and so re-fires on a later re-breach.
 */
export function reconcileAcknowledgedWarnings(
  previousAcknowledged: AcknowledgedSignatures,
  currentWarnings: PlausibilityWarning[],
  currentSignatures: AcknowledgedSignatures,
): AcknowledgmentResult {
  const toShow: PlausibilityWarning[] = [];
  const nextAcknowledged: AcknowledgedSignatures = {};

  for (const warning of currentWarnings) {
    const signature = currentSignatures[warning.field];
    // Record the current signature: a shown warning becomes acknowledged, an
    // unchanged one stays acknowledged. Fields absent here (no longer breaching)
    // are never added, which is exactly how in-range clears a signature.
    nextAcknowledged[warning.field] = signature;
    if (previousAcknowledged[warning.field] !== signature) {
      toShow.push(warning);
    }
  }

  return { toShow, nextAcknowledged };
}

/**
 * The Art-change „reset all" path: return a fresh empty acknowledged set so
 * every field is re-evaluated against the newly selected Art's Artennorm. A new
 * object each call keeps callers from sharing mutable reset state.
 */
export function resetAcknowledgedSignatures(): AcknowledgedSignatures {
  return {};
}
