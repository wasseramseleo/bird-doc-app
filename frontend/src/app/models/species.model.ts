import { RingSize } from './ring.model';

// Issue #57: the Sonderart discriminator (replaces the former is_sentinel
// boolean). A non-empty value marks a non-taxon Species row that is always
// selectable (it bypasses the active Artenliste). Each kind derives its own
// behaviour — see CONTEXT.md (Sonderart) and ADR 0004.
export type SpecialKind = '' | 'ring_destroyed' | 'unknown_species';

export interface Species {
  id: string;
  common_name_de: string;
  common_name_en: string;
  scientific_name: string;
  family_name: string;
  order_name: string;
  ring_size: RingSize | null;
  // '' — a normal taxon; 'ring_destroyed' — the "Ring Vernichtet" marker (no
  // bird; collapses the form; bird data nulled server-side); 'unknown_species'
  // — "Art nicht in der Liste (Aves ignota)" (a real bird; full form; Bemerkung
  // mandatory).
  special_kind: SpecialKind;
}
