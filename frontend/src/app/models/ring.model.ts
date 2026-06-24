// The full Austrian ringing scheme (AOC / Österreichische Vogelwarte), mirroring
// the backend Ring.RingSizes. Declared largest → smallest inner diameter; the
// member order is the canonical UI order. The "A" suffix denotes Stahl (steel),
// the "S" suffix "mit Lasche" (with tab). Codes can be multi-letter (AS, DS),
// which is why selection is by native type-ahead, not a single-char shortcut.
export enum RingSize {
  AS = 'AS',
  BS = 'BS',
  C = 'C',
  D = 'D',
  DS = 'DS',
  DA = 'DA',
  F = 'F',
  FA = 'FA',
  G = 'G',
  GA = 'GA',
  H = 'H',
  HA = 'HA',
  K = 'K',
  KA = 'KA',
  L = 'L',
  LA = 'LA',
  M = 'M',
  N = 'N',
  NA = 'NA',
  P = 'P',
  PA = 'PA',
  R = 'R',
  S = 'S',
  SA = 'SA',
  T = 'T',
  TA = 'TA',
  V = 'V',
  X = 'X',
}
export interface Ring {
  id: string;
  number: string;
  size: RingSize;
}
