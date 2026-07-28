import {Central} from './central.model';
import {Organization} from './organization.model';
import {RingingStation} from './ringing-station.model';
import {Scientist} from './scientist.model';

// Which programme a Projekt runs — descriptive, internal metadata only (ADR
// 0023). It is never exported and gates no capture field; an unset Projekttyp
// reads as Sonstiges (the backend default). Values mirror the backend enum.
export enum Projekttyp {
  IWM = 'IWM',
  IMS = 'IMS',
  Zugvogelmonitoring = 'ZUGVOGELMONITORING',
  Nestlingsberingung = 'NESTLINGSBERINGUNG',
  Sonstiges = 'SONSTIGES',
}

// The German label per Projekttyp — the single source of truth shared by the
// create/edit dialog selects and the dashboard info line.
export const PROJEKTTYP_LABELS: Record<Projekttyp, string> = {
  [Projekttyp.IWM]: 'IWM',
  [Projekttyp.IMS]: 'IMS',
  [Projekttyp.Zugvogelmonitoring]: 'Zugvogelmonitoring',
  [Projekttyp.Nestlingsberingung]: 'Nestlingsberingung',
  [Projekttyp.Sonstiges]: 'Sonstiges',
};

// The Projekttyp options in display order, for the dialog mat-selects.
export const PROJEKTTYP_OPTIONS: {value: Projekttyp; viewValue: string}[] = [
  Projekttyp.IWM,
  Projekttyp.IMS,
  Projekttyp.Zugvogelmonitoring,
  Projekttyp.Nestlingsberingung,
  Projekttyp.Sonstiges,
].map((value) => ({value, viewValue: PROJEKTTYP_LABELS[value]}));

// Optionale Felder (ADR 0035, issue #430): the fixed, app-wide vocabulary of
// capture-form fields a Projekt may switch OFF. Mirrors the backend enum
// (`Project.OptionalField`) key for key — the Projekt serializer's ChoiceField is
// what stops the two hand-mirrored vocabularies drifting silently apart.
// `NetzBlock` is ONE entry covering Netznr., Netzfach and Flugrichtung together;
// the three are never wanted individually. Everything else the form asks for — the
// Spine and the Kern (Gewicht, Flügellänge, …) — is deliberately absent, so no
// Projekt can switch a mandatory Datenmeldung column off.
export enum OptionalField {
  Brutfleck = 'brood_patch',
  CplPlus = 'cpl_plus',
  Hungerstreifen = 'hunger_stripes',
  Parasit = 'parasit',
  KerbeF2 = 'notch_f2',
  Innenfuss = 'inner_foot',
  NetzBlock = 'net_block',
}

// The vocabulary in display order — the single source of truth shared by both
// Projekt-Dialoge and the capture form's visibility query.
export const OPTIONAL_FIELD_ORDER: readonly OptionalField[] = [
  OptionalField.Brutfleck,
  OptionalField.CplPlus,
  OptionalField.Hungerstreifen,
  OptionalField.Parasit,
  OptionalField.KerbeF2,
  OptionalField.Innenfuss,
  OptionalField.NetzBlock,
];

export const OPTIONAL_FIELD_LABELS: Record<OptionalField, string> = {
  [OptionalField.Brutfleck]: 'Brutfleck',
  [OptionalField.CplPlus]: 'CPL+',
  [OptionalField.Hungerstreifen]: 'Hungerstreifen',
  [OptionalField.Parasit]: 'Parasit',
  [OptionalField.KerbeF2]: 'Kerbe F2',
  [OptionalField.Innenfuss]: 'Innenfuß',
  [OptionalField.NetzBlock]: 'Netz (Netznr., Netzfach, Flugrichtung)',
};

// The options both Projekt-Dialoge render as checkboxes, in display order.
export const OPTIONAL_FIELD_OPTIONS: {value: OptionalField; viewValue: string}[] =
  OPTIONAL_FIELD_ORDER.map((value) => ({value, viewValue: OPTIONAL_FIELD_LABELS[value]}));

/**
 * The dialogs' „angehakt = sichtbar" view of a Projekt's stored opt-out list
 * (ADR 0035). A field the Projekt does not hide reads as ticked, so an unconfigured
 * Projekt shows every box ticked.
 */
export function optionalFieldVisibility(
  hidden: readonly OptionalField[] | null | undefined,
): Record<OptionalField, boolean> {
  const off = new Set(hidden ?? []);
  return Object.fromEntries(
    OPTIONAL_FIELD_ORDER.map((field) => [field, !off.has(field)]),
  ) as Record<OptionalField, boolean>;
}

/**
 * The inversion back to what gets stored: the opt-out list is what the Admin
 * *un*ticked. Returned in vocabulary order, so the displayed order never leaks into
 * the payload — the list is a set of switched-off fields, not a sequence.
 */
export function hiddenOptionalFieldsFrom(
  visibility: Partial<Record<OptionalField, boolean>>,
): OptionalField[] {
  return OPTIONAL_FIELD_ORDER.filter((field) => visibility[field] !== true);
}

export interface Project {
  id: string;
  title: string;
  description: string;
  // Optionale Felder (ADR 0035, issue #430): the fields this Projekt has switched
  // OFF. An opt-out — absent/empty means every optional field is visible, so a
  // Projekt nobody configured shows everything. Optional on the read shape because
  // a Projekt cached by an older bundle predates the field; reading it as „nothing
  // hidden" is the deliberate fallback (a device on an outdated version shows all
  // optional fields for one update cycle).
  hidden_optional_fields?: OptionalField[] | null;
  projekttyp: Projekttyp;
  // The optional per-Projekt Saison window (ADR 0029, issue #373): an inclusive,
  // wrap-around-allowed month window (1–12) set manually in the Projekt settings.
  // Both null/undefined ⇒ no season configured, which hides the dashboard's
  // „Diese Saison" preset. Optional because legacy/partial payloads may omit them;
  // the dashboard treats „configured" as both months present.
  saison_start_month?: number | null;
  saison_end_month?: number | null;
  organization: Organization;
  // The Projekt's Zentrale (ADR 0019), carried on the GET/bundle shape (#233) so
  // a bundled Projekt knows the Zentrale a domestic capture defaults to. Optional
  // because there is no per-Projekt Zentrale selector yet (today always AUW).
  central?: Central;
  default_station: RingingStation | null;
  scientists: Scientist[];
  created: string;
  updated: string;
}

export interface ProjectCreatePayload {
  title: string;
  description?: string;
  // No organization_id: the server attaches the new Projekt to the requester's
  // active Organisation and ignores any client-supplied one (issue #389).
  scientist_ids: string[];
  projekttyp?: Projekttyp;
  // The Optionale-Felder opt-out list (ADR 0035): omitted or empty ⇒ the new
  // Projekt shows every optional field.
  hidden_optional_fields?: OptionalField[];
  default_station_id?: string | null;
  // The Saison window (ADR 0029): both null ⇒ the Projekt gets no season.
  saison_start_month?: number | null;
  saison_end_month?: number | null;
}

export interface ProjectUpdatePayload {
  title: string;
  description: string;
  scientist_ids: string[];
  // The Optionale-Felder opt-out list (ADR 0035): an empty list makes every
  // optional field visible again.
  hidden_optional_fields?: OptionalField[];
  projekttyp?: Projekttyp;
  default_station_id?: string | null;
  // The Saison window (ADR 0029): both null clears the season (preset hidden).
  saison_start_month?: number | null;
  saison_end_month?: number | null;
}
