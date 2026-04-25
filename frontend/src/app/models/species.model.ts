import { RingSize } from './ring.model';

export interface Species {
  id: string;
  common_name_de: string;
  common_name_en: string;
  scientific_name: string;
  family_name: string;
  order_name: string;
  ring_size: RingSize | null;
}
