#!/usr/bin/env node
// Der Icon-Seam ist nur so viel wert, wie er dicht ist (#439, ADR 0037).
//
// Zwei Regeln, beide repo-weit über `frontend/src` geprüft:
//
//   1. Kein Template benennt ein Material-Icon für die Rolle „leer oder kaputt".
//      Wer einen leeren oder einen Fehlerzustand baut, schreibt `app-icon-empty`
//      bzw. `app-icon-error` an das `<mat-icon>` — den Namen der Glyphe kennt nur
//      der Seam.
//   2. Die Hinterlegung — die Glyphen und die Tabelle, die sie trägt — kommt an
//      genau einer Stelle vor: in der Seam-Datei, Specs eingeschlossen. Damit
//      ist „Einwechseln ist eine Datei" nicht nur behauptet, sondern
//      nachgewiesen.
//
// Welche Glyphen das sind, weiß dieses Skript nicht selbst: es liest sie aus der
// Seam-Datei. Ein Check, der die Hinterlegung wiederholt, wäre nach dem ersten
// Tausch grün und wirkungslos zugleich.
//
// Aufruf: `npm run check:icon-seam` (läuft auch in `npm test` und in der CI).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC_ROOT = join(FRONTEND_ROOT, 'src');

/** Die eine Stelle. Nur hier dürfen die Glyphen stehen. */
const SEAM_FILE = join('src', 'app', 'shared', 'app-icons.ts');

/** Der Name der Tabelle in der Seam-Datei, die die Hinterlegungen trägt. */
const BACKING_TABLE = 'APP_ICON_BACKINGS';

/**
 * Was heute hinter `app-icon-error` und `app-icon-empty` steckt — aus der
 * Seam-Datei **gelesen**, nicht hier wiederholt.
 *
 * Stünden die Glyphen auch hier, wäre „Einwechseln ist eine Datei" gelogen: wer
 * in `app-icons.ts` tauscht und dieses Skript vergisst, hätte danach einen
 * Check, der die alte Glyphe bewacht — grün, aber wirkungslos, weil die neue
 * Hinterlegung überall stehen dürfte. Deshalb liest der Check die Tabelle; und
 * wenn er sie nicht lesen kann, bricht er laut ab, statt still nichts zu prüfen.
 */
function readSeamBackings() {
  const seamPath = join(FRONTEND_ROOT, SEAM_FILE);
  const source = readFileSync(seamPath, 'utf8');
  const table = source.match(new RegExp(`export const ${BACKING_TABLE}\\s*=\\s*\\{([^}]*)\\}`));
  const backings = table ? [...table[1].matchAll(/:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]) : [];

  if (backings.length < 2) {
    console.error(
      `Icon-Seam-Check kaputt (#439):\n\n  ${SEAM_FILE} hat keine lesbare ` +
        `\`export const ${BACKING_TABLE} = { … }\`-Tabelle mit mindestens zwei ` +
        `String-Hinterlegungen mehr.\n  Der Check kann nicht raten, welche Glyphen ` +
        `er bewachen soll — und will lieber abbrechen als grün nichts prüfen.\n`,
    );
    process.exit(1);
  }
  return backings;
}

const SEAM_BACKINGS = readSeamBackings();

/**
 * Was außer den Glyphen selbst nur in der Seam-Datei stehen darf: die Tabelle.
 * Wer sie woanders importiert, holt sich die Glyphe an der Naht vorbei zurück.
 */
const SEAM_ONLY = [...SEAM_BACKINGS, BACKING_TABLE];

// Die Glyphen, die den leeren oder den kaputten Zustand tragen — plus die
// naheliegenden Griffe daneben, damit die Rolle nicht über einen Nachbarn
// zurückkommt. Was heute im Seam hinterlegt ist, kommt von dort dazu und muss
// hier nicht gepflegt werden. Bewusst NICHT dabei: `warning` (die
// Plausibilitätswarnung ist laut ADR 0037 keine Fehlerklasse) und `cloud_off`
// (der Offline-Zustand hat sein eigenes Idiom).
const ROLE_LIGATURES = [
  ...new Set([
    ...SEAM_BACKINGS,
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
  ]),
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

// Regel 2 — die Hinterlegung des Seams steht an genau einer Stelle. Specs sind
// hier ausdrücklich NICHT ausgenommen: eine Spec, die `error_outline`
// festnagelt, macht aus dem Einwechseln zwei Dateien statt einer — und ist
// obendrein die falsche Prüfung. Was eine Spec über den Seam wissen darf, ist
// *dass* etwas gezeichnet wird und dass leer und kaputt verschieden aussehen
// (siehe `app-icons.spec.ts` und `app-icons.testing.ts`), nie *was*.
for (const file of files.filter((f) => f.endsWith('.ts') || f.endsWith('.html'))) {
  const rel = relative(FRONTEND_ROOT, file);
  if (rel === SEAM_FILE.split(sep).join(sep)) continue;
  const source = readFileSync(file, 'utf8');
  for (const name of SEAM_ONLY) {
    const occurrence = new RegExp(`\\b${name}\\b`);
    if (!occurrence.test(source)) continue;
    const line = source.split('\n').findIndex((l) => occurrence.test(l)) + 1;
    failures.push(
      `${rel}:${line}: „${name}" gehört zur Hinterlegung des Icon-Seams und ` +
        `ausschließlich nach ${SEAM_FILE} — sonst ist „Einwechseln ist eine Datei" nicht wahr.`,
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
