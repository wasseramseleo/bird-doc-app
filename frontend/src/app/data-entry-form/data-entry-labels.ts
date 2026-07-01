import { AgeClass, Sex } from '../models/data-entry.model';

// Shared, readable German labels for the Alter (age class) and Geschlecht (sex)
// coded values. Extracted here so both the capture form's "Bisherige Fänge"
// summary and the detail dialog render the same text without duplicating the
// maps.

const AGE_CLASS_LABELS: Record<number, string> = {
  [AgeClass.Nest]: '1 – Nestling',
  [AgeClass.Unknown]: '2 – Fängling (unbekannt)',
  [AgeClass.ThisYear]: '3 – Diesjährig',
  [AgeClass.NotThisYear]: '4 – Nicht Diesjährig',
  [AgeClass.LastYear]: '5 – Vorjährig',
  [AgeClass.NotLastYear]: '6 – Nicht Vorjährig',
};

const SEX_LABELS: Record<number, string> = {
  [Sex.Unknown]: '0 – Unbekannt',
  [Sex.Male]: '1 – Männlich',
  [Sex.Female]: '2 – Weiblich',
};

export function getAgeClassLabel(value: AgeClass | null | undefined): string {
  return value !== null && value !== undefined ? (AGE_CLASS_LABELS[value] ?? String(value)) : '—';
}

export function getSexLabel(value: Sex | null | undefined): string {
  return value !== null && value !== undefined ? (SEX_LABELS[value] ?? String(value)) : '—';
}
