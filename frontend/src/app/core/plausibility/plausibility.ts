/**
 * The Plausibilitätsprüfung (feature Artenattribute, PRD #245, ADR 0021).
 *
 * `computePlausibilityWarnings` is a **pure** function and the single source of
 * truth for both the inline Plausibilitätswarnung under a field and the
 * save-time acknowledgment dialog. It takes the current measurements plus the
 * effective Artennorm for the selected Art and returns the active warnings, each
 * carrying a human-readable Austrian-German (de-AT) message stating the measured
 * value and the expected range.
 *
 * Issue #246 established the **Gewicht** σ-band (Ø ± sd_factor·SD); issue #247
 * extends it to the other five σ-measurements (Federlänge, Flügellänge, Tarsus,
 * Kerbe F2, Innenfuß), each reusing the same sigmaBandWarning helper and
 * optionality. It stays deliberately shaped so #248/#249 can add the Quotient
 * (relative band) and the two categorical flags by pushing further entries —
 * never by reshaping the signature.
 */

// A DecimalField rides the wire as a string; a form control holds a number.
// Both (and null/'' for "not set") are accepted and coerced.
type Numeric = number | string | null | undefined;

/** One effective Artennorm (override ?? default), as served by the per-org
 * norms API and embedded in the offline bundle. Every rule column is optional:
 * a null Ø/SD pair (or a null flag) means that particular check is off. */
export interface SpeciesNorm {
  species_id: string;
  species_name: string;
  weight_mean: Numeric;
  weight_sd: Numeric;
  feather_mean: Numeric;
  feather_sd: Numeric;
  wing_mean: Numeric;
  wing_sd: Numeric;
  tarsus_mean: Numeric;
  tarsus_sd: Numeric;
  notch_f2_mean: Numeric;
  notch_f2_sd: Numeric;
  inner_foot_mean: Numeric;
  inner_foot_sd: Numeric;
  quotient_mean: Numeric;
  quotient_tolerance_pct: Numeric;
  sd_factor: Numeric;
  geschlechtsbestimmung_moeglich: boolean | null;
  dj_grossgefiedermauser_moeglich: boolean | null;
}

/** The measurements a capture carries that plausibility can check. Every field
 * is optional so a partly-filled form (or a later slice) passes only what it
 * has. */
export interface PlausibilityMeasurements {
  weight_gram?: Numeric;
  feather_span?: Numeric;
  wing_span?: Numeric;
  tarsus?: Numeric;
  notch_f2?: Numeric;
  inner_foot?: Numeric;
  sex?: number | null;
  age_class?: number | null;
  hand_wing?: number | null;
}

/** One active warning: the form field it belongs under, and its de-AT message. */
export interface PlausibilityWarning {
  field: string;
  message: string;
}

const DEFAULT_SD_FACTOR = 1.96;
// Issue #248: the Quotient's relative band defaults to ±3 % when the norm sets a
// quotient_mean but no explicit quotient_tolerance_pct.
const DEFAULT_QUOTIENT_TOLERANCE_PCT = 3;

// de-AT: comma decimal separator, at most one fraction digit (matching the
// brief's "7,5–10,7 g").
const deAt = new Intl.NumberFormat('de-AT', { maximumFractionDigits: 1 });
// The Quotient is a dimensionless ratio around 0,7–0,8, so one fraction digit is
// too coarse to name it meaningfully — it and its band always show two decimals.
const deAtRatio = new Intl.NumberFormat('de-AT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function toNumber(value: Numeric): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * A σ-band Ausreißertest for one measurement: warns when the value lies outside
 * Ø ± sd_factor·SD. Fires only when the value is present AND the norm's Ø and SD
 * are both set (otherwise the check is off). Returns the field's warning, or
 * `null` when there is nothing to warn about.
 */
function sigmaBandWarning(
  field: string,
  label: string,
  unit: string,
  value: Numeric,
  mean: Numeric,
  sd: Numeric,
  sdFactor: Numeric,
  speciesName: string,
): PlausibilityWarning | null {
  const measured = toNumber(value);
  const mu = toNumber(mean);
  const sigma = toNumber(sd);
  if (measured === null || mu === null || sigma === null) {
    return null;
  }
  const k = toNumber(sdFactor) ?? DEFAULT_SD_FACTOR;
  const low = mu - k * sigma;
  const high = mu + k * sigma;
  if (measured >= low && measured <= high) {
    return null;
  }
  const message =
    `${label} ${deAt.format(measured)} ${unit} liegt außerhalb des erwarteten ` +
    `Bereichs ${deAt.format(low)}–${deAt.format(high)} ${unit} (${speciesName})`;
  return { field, message };
}

/**
 * Issue #248: the Quotient Ausreißertest. The DERIVED ratio Federlänge/Flügellänge
 * (feather_span/wing_span, no stored field) is tested against a RELATIVE band
 * quotient_mean ± quotient_tolerance_pct (default 3 %) — catching a wing/feather
 * transposition that leaves each value individually plausible but their ratio off.
 * It is a distinct band type (relative, not σ) reading the two measurement fields
 * directly, so it fires independently of whether the σ rules for Federlänge/
 * Flügellänge exist. Fires only when the quotient norm is set AND BOTH operands
 * are present — a blank (or a zero-division Flügellänge) suppresses it. Surfaces
 * under its own synthetic `quotient` field so it never collides with the two
 * operands' σ warnings.
 */
function quotientBandWarning(
  featherSpan: Numeric,
  wingSpan: Numeric,
  quotientMean: Numeric,
  tolerancePct: Numeric,
  speciesName: string,
): PlausibilityWarning | null {
  const feather = toNumber(featherSpan);
  const wing = toNumber(wingSpan);
  const mean = toNumber(quotientMean);
  if (feather === null || wing === null || mean === null || wing === 0) {
    return null;
  }
  const tol = toNumber(tolerancePct) ?? DEFAULT_QUOTIENT_TOLERANCE_PCT;
  const quotient = feather / wing;
  const low = mean * (1 - tol / 100);
  const high = mean * (1 + tol / 100);
  if (quotient >= low && quotient <= high) {
    return null;
  }
  const message =
    `Quotient Federlänge/Flügellänge ${deAtRatio.format(quotient)} liegt außerhalb ` +
    `des erwarteten Bereichs ${deAtRatio.format(low)}–${deAtRatio.format(high)} (${speciesName})`;
  return { field: 'quotient', message };
}

export function computePlausibilityWarnings(
  measurements: PlausibilityMeasurements,
  norm: SpeciesNorm | null,
): PlausibilityWarning[] {
  if (!norm) {
    return [];
  }
  const warnings: PlausibilityWarning[] = [];

  // Each σ-measurement reuses the identical sigmaBandWarning helper (Ø ±
  // sd_factor·SD) and per-field optionality — it fires only when both the norm's
  // Ø/SD pair and the field's value are present. The order here is the order the
  // discrepancies appear in the aggregated save-time dialog. Gewicht is grams;
  // the five #247 measurements are millimetres.
  const checks: (PlausibilityWarning | null)[] = [
    sigmaBandWarning(
      'weight_gram',
      'Gewicht',
      'g',
      measurements.weight_gram,
      norm.weight_mean,
      norm.weight_sd,
      norm.sd_factor,
      norm.species_name,
    ),
    sigmaBandWarning(
      'feather_span',
      'Federlänge',
      'mm',
      measurements.feather_span,
      norm.feather_mean,
      norm.feather_sd,
      norm.sd_factor,
      norm.species_name,
    ),
    sigmaBandWarning(
      'wing_span',
      'Flügellänge',
      'mm',
      measurements.wing_span,
      norm.wing_mean,
      norm.wing_sd,
      norm.sd_factor,
      norm.species_name,
    ),
    sigmaBandWarning(
      'tarsus',
      'Tarsus',
      'mm',
      measurements.tarsus,
      norm.tarsus_mean,
      norm.tarsus_sd,
      norm.sd_factor,
      norm.species_name,
    ),
    sigmaBandWarning(
      'notch_f2',
      'Kerbe F2',
      'mm',
      measurements.notch_f2,
      norm.notch_f2_mean,
      norm.notch_f2_sd,
      norm.sd_factor,
      norm.species_name,
    ),
    sigmaBandWarning(
      'inner_foot',
      'Innenfuß',
      'mm',
      measurements.inner_foot,
      norm.inner_foot_mean,
      norm.inner_foot_sd,
      norm.sd_factor,
      norm.species_name,
    ),
    // Issue #248: the derived Quotient (relative band). Independent of the two
    // σ operand rules above; listed last so it trails them in the aggregated
    // save-time dialog.
    quotientBandWarning(
      measurements.feather_span,
      measurements.wing_span,
      norm.quotient_mean,
      norm.quotient_tolerance_pct,
      norm.species_name,
    ),
  ];

  for (const check of checks) {
    if (check) {
      warnings.push(check);
    }
  }

  return warnings;
}
