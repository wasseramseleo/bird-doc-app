import {OrganizationRolle} from './auth-user.model';

// The linked login account of an account-linked (Mitglied) Beringer. Present
// only on an Admin request to /scientists/ (the Beringer verwalten page); the
// shared autocomplete list omits it entirely so no member data leaks (PRD #205).
export interface BeringerAccount {
  display_name: string;
  email: string;
  rolle: OrganizationRolle;
}

// A Beringer as seen on the Org-Admin "Beringer verwalten" page. The lean fields
// (id, handle, names, full_name) are always present; the account fields are
// added only for an Admin request — `is_member` marks whether the Beringer is a
// Mitglied (account-linked) or Ohne Konto, and `account` carries the linked
// account's identity when it is one.
export interface Beringer {
  id: string;
  handle: string;
  first_name: string;
  last_name: string;
  full_name: string;
  is_member?: boolean;
  account?: BeringerAccount | null;
  // The number of Fänge this Beringer owns, present only on an Admin request. The
  // delete confirmation names it: deleting a capture-owning Beringer reassigns its
  // captures to „Gelöschter Nutzer" (PRD #205, issue #208).
  capture_count?: number;
}
