import {Organization} from './organization.model';

export interface RingingStation {
  handle: string;
  name: string;
  organization?: Organization;
  // Geographic data the IWM export reads off each capture. Decimals arrive from
  // DRF as strings; keep them as strings so no precision is lost in JS floats.
  country?: string;
  region?: string;
  place_code?: string;
  latitude?: string | null;
  longitude?: string | null;
  // Archived Stationen stay attached to their captures but leave the picker.
  is_active?: boolean;
}

// The Admin supplies only human fields; the handle and organization are
// server-owned. Name, Ortskodierung and coordinates are required; Land defaults
// from the Organisation's country when omitted, Region is optional.
export interface RingingStationCreatePayload {
  name: string;
  place_code: string;
  latitude: string;
  longitude: string;
  region?: string;
  country?: string;
}
