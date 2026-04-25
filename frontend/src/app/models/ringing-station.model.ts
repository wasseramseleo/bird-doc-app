import {Organization} from './organization.model';

export interface RingingStation {
  handle: string;
  name: string;
  organization?: Organization;
}
