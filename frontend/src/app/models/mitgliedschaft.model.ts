import {OrganizationRolle} from './auth-user.model';

// A Mitgliedschaft (seat) as seen by the Organisation's Admin (issue #83, #209).
// `handle` mirrors the seat's account Beringer live: it is the linked Beringer's
// Kürzel, or `null` when the account is not (yet) a Beringer — the "gap seat" an
// Admin can link an existing no-account Beringer to (PRD #205).
export interface Mitgliedschaft {
  id: string;
  username: string;
  email: string;
  handle: string | null;
  rolle: OrganizationRolle;
  created: string;
}
