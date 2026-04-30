import {Organization} from './organization.model';
import {Scientist} from './scientist.model';

export interface Project {
  id: string;
  title: string;
  description: string;
  show_optional_fields: boolean;
  organization: Organization;
  scientists: Scientist[];
  created: string;
  updated: string;
}

export interface ProjectCreatePayload {
  title: string;
  description?: string;
  organization_id: string;
}

export interface ProjectUpdatePayload {
  title: string;
  description: string;
  scientist_ids: string[];
  show_optional_fields?: boolean;
}
