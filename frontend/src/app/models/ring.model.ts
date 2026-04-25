export enum RingSize {
  XSmall = 'V',
  Small = 'T',
  Medium = 'S',
  Large = 'X',
  XLarge = 'P',
}
export interface Ring {
  id: string;
  number: string;
  size: RingSize;
}
