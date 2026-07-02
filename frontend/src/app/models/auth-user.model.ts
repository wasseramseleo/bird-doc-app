import {Organization} from './organization.model';

export type OrganizationRolle = 'admin' | 'mitglied' | null;

/**
 * The identity a Mitglied's session resolves to: user, active Organisation,
 * Rolle. Cached in IndexedDB after a successful online session check (issue
 * #156) so an offline cold boot can fall back to it.
 */
export interface AuthUser {
  username: string;
  handle: string | null;
  isStaff: boolean;
  rolle: OrganizationRolle;
  organization: Organization | null;
}
