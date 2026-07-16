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

export interface Project {
  id: string;
  title: string;
  description: string;
  show_optional_fields: boolean;
  // Netzfelder anzeigen (issue #336, ADR 0023): an independent per-Projekt switch
  // (default on, parallel to show_optional_fields, NOT derived from projekttyp)
  // that hides the capture form's net block when false. Honoured offline from the
  // project cache, same path show_optional_fields rides.
  show_net_fields: boolean;
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
  organization_id: string;
  projekttyp?: Projekttyp;
  show_net_fields?: boolean;
  default_station_id?: string | null;
}

export interface ProjectUpdatePayload {
  title: string;
  description: string;
  scientist_ids: string[];
  show_optional_fields?: boolean;
  show_net_fields?: boolean;
  projekttyp?: Projekttyp;
  default_station_id?: string | null;
  // The Saison window (ADR 0029): both null clears the season (preset hidden).
  saison_start_month?: number | null;
  saison_end_month?: number | null;
}
