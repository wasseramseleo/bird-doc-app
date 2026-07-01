// The IWM import report shapes, mirroring the backend contract (PRD #113). The
// dry-run returns an ImportPreview (nothing written); the commit returns an
// ImportResult. Fields not yet populated by the current backend slice
// (duplicates, warnings, toCreate, cap) are present so the shape stays fixed.

export interface ImportRowError {
  row: number;
  reason: string;
}

export interface ImportPreview {
  importable: number;
  duplicates: number;
  errors: ImportRowError[];
  warnings: ImportRowError[];
  toCreate: {
    beringer: string[];
    stationen: string[];
  };
  cap: {
    limit: number;
    exceeded: boolean;
  };
}

export interface ImportResult {
  created: number;
  duplicatesSkipped: number;
  errors: ImportRowError[];
  createdBeringer: string[];
  createdStationen: string[];
}
