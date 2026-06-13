import {Organization} from './organization.model';
import {RingingStation} from './ringing-station.model';
import {Scientist} from './scientist.model';

export interface Project {
  id: string;
  title: string;
  description: string;
  show_optional_fields: boolean;
  organization: Organization;
  default_station: RingingStation | null;
  scientists: Scientist[];
  created: string;
  updated: string;
}

export interface ProjectCreatePayload {
  title: string;
  description?: string;
  organization_id: string;
  default_station_id?: string | null;
}

export interface ProjectUpdatePayload {
  title: string;
  description: string;
  scientist_ids: string[];
  show_optional_fields?: boolean;
  default_station_id?: string | null;
}
