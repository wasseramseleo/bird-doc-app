import { RingSize } from './ring.model';

export interface Species {
  id: string;
  common_name_de: string;
  common_name_en: string;
  scientific_name: string;
  family_name: string;
  order_name: string;
  ring_size: RingSize | null;
  // Issue #19: a sentinel Art (e.g. "Ring Vernichtet") stands for a record that
  // carries no bird data. The backend always includes sentinels in the species
  // autocomplete and nulls the bird fields server-side.
  is_sentinel: boolean;
}
