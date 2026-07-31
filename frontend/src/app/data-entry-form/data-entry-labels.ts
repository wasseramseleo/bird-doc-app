import { AgeClass, BirdStatus, Sex } from '../models/data-entry.model';

// Shared, readable German labels for the Ringstatus (bird status), Alter (age
// class) and Geschlecht (sex) coded values. Extracted here so every surface
// that lists captures renders the same text without duplicating the maps — the
// capture form's "Bisherige Fänge" summary, the detail dialog, "Letzte Fänge"
// and both branches of "Heute".
//
// Every function answers a missing value with a dash. That is the whole point
// of the seam: an absent coded value is an absence, and the label says so
// instead of letting a caller default it to whichever branch its ternary
// happened to put last.
//
// #469: this module is the ONLY place in `src` allowed to spell "Erstfang" or
// "Wiederfang" as a bare string — `scripts/check-vokabular.mjs` enforces it.

const BIRD_STATUS_LABELS: Record<string, string> = {
  [BirdStatus.FirstCatch]: 'Erstfang',
  [BirdStatus.ReCatch]: 'Wiederfang',
};

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

/**
 * Der Ringstatus als Wort (#469, CONTEXT.md „Erstfang / Wiederfang").
 *
 * Das Paar ist **nicht erschöpfend**: ein *Ring vernichtet* ist keines von
 * beidem, sein Ringstatus gehört zu den Vogeldaten, die das Backend vorsätzlich
 * leert. Ein fehlender Wert wird deshalb zum Gedankenstrich — dieselbe leere
 * Zelle wie Tarsus, Federlänge und Gewicht daneben — und nicht zu „Wiederfang",
 * was eine gelöschte Tatsache behaupten hieße.
 */
export function getBirdStatusLabel(value: BirdStatus | null | undefined): string {
  return value !== null && value !== undefined
    ? (BIRD_STATUS_LABELS[value] ?? String(value))
    : '—';
}

export function getAgeClassLabel(value: AgeClass | null | undefined): string {
  return value !== null && value !== undefined ? (AGE_CLASS_LABELS[value] ?? String(value)) : '—';
}

export function getSexLabel(value: Sex | null | undefined): string {
  return value !== null && value !== undefined ? (SEX_LABELS[value] ?? String(value)) : '—';
}
