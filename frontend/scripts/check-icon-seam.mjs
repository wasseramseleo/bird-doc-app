#!/usr/bin/env node
// Der Icon-Seam ist nur so viel wert, wie er dicht ist (#439, ADR 0037).
//
// Zwei Regeln, beide repo-weit über `frontend/src` geprüft:
//
//   1. Kein Template benennt ein Material-Icon für die Rolle „leer oder kaputt".
//      Wer einen leeren oder einen Fehlerzustand baut, schreibt `app-icon-empty`
//      bzw. `app-icon-error` an das `<mat-icon>` — den Namen der Glyphe kennt nur
//      der Seam.
//   2. Die Glyphen, die heute hinter den beiden Namen stehen, kommen an genau
//      einer Stelle vor: in der Seam-Datei. Damit ist „Einwechseln ist eine
//      Datei" nicht nur behauptet, sondern nachgewiesen.
//
// Aufruf: `npm run check:icon-seam` (läuft auch in `npm test` und in der CI).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC_ROOT = join(FRONTEND_ROOT, 'src');

/** Die eine Stelle. Nur hier dürfen die Glyphen stehen. */
const SEAM_FILE = join('src', 'app', 'shared', 'app-icons.ts');

/** Was heute hinter `app-icon-error` und `app-icon-empty` steckt. */
const SEAM_LIGATURES = ['error_outline', 'inbox'];

// Die Glyphen, die den leeren oder den kaputten Zustand tragen — plus die
// naheliegenden Griffe daneben, damit die Rolle nicht über einen Nachbarn
// zurückkommt. Bewusst NICHT dabei: `warning` (die Plausibilitätswarnung ist
// laut ADR 0037 keine Fehlerklasse) und `cloud_off` (der Offline-Zustand hat
// sein eigenes Idiom).
const ROLE_LIGATURES = [
  'error',
  'error_outline',
  'report_problem',
  'dangerous',
  'broken_image',
  'sync_problem',
  'inbox',
  'insights',
  'search_off',
  'folder_off',
  'sentiment_dissatisfied',
  'hourglass_empty',
];

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...walk(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

const files = walk(SRC_ROOT);
const failures = [];

// Regel 1 — Templates benennen keine Rollen-Glyphe mehr.
const matIcon = /<mat-icon\b[^>]*>([\s\S]*?)<\/mat-icon>/g;
for (const file of files.filter((f) => f.endsWith('.html'))) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(matIcon)) {
    const ligature = match[1].trim();
    if (!ROLE_LIGATURES.includes(ligature)) continue;
    const line = source.slice(0, match.index).split('\n').length;
    failures.push(
      `${relative(FRONTEND_ROOT, file)}:${line}: <mat-icon> benennt „${ligature}" — ` +
        `benutze stattdessen app-icon-error bzw. app-icon-empty.`,
    );
  }
}

// Regel 2 — die Glyphen des Seams stehen an genau einer Stelle.
for (const file of files.filter((f) => f.endsWith('.ts') || f.endsWith('.html'))) {
  const rel = relative(FRONTEND_ROOT, file);
  if (rel === SEAM_FILE.split(sep).join(sep)) continue;
  if (rel.endsWith('.spec.ts')) continue; // Specs dürfen den Seam nachmessen.
  const source = readFileSync(file, 'utf8');
  for (const ligature of SEAM_LIGATURES) {
    if (!new RegExp(`\\b${ligature}\\b`).test(source)) continue;
    const line = source.split('\n').findIndex((l) => new RegExp(`\\b${ligature}\\b`).test(l)) + 1;
    failures.push(
      `${rel}:${line}: „${ligature}" ist die Hinterlegung des Icon-Seams und gehört ` +
        `ausschließlich nach ${SEAM_FILE}.`,
    );
  }
}

if (failures.length > 0) {
  console.error('Icon-Seam verletzt (#439):\n');
  for (const failure of failures) console.error(`  ${failure}`);
  console.error(`\n${failures.length} Verletzung(en).`);
  process.exit(1);
}

console.log(`Icon-Seam dicht: ${files.length} Dateien geprüft.`);
