#!/usr/bin/env node
// Der Icon-Seam ist nur so viel wert, wie er dicht ist (#439, ADR 0037; für die
// gezeichneten Vögel umgebaut in #514, ADR 0044).
//
// Zwei Regeln, beide repo-weit über `frontend/src` geprüft:
//
//   1. Kein Template benennt ein Material-Icon für die Rolle „leer oder kaputt".
//      Wer einen leeren oder einen Fehlerzustand baut, schreibt `app-icon-empty`
//      bzw. `app-icon-error` an das `<mat-icon>` — was dahintersteht, weiß nur
//      der Seam.
//   2. Die Hinterlegung — die Namen, die Tabelle, die sie trägt, **und die
//      Zeichnungen selbst** — kommt an genau einer Stelle vor: in der
//      Seam-Datei, Specs eingeschlossen. Damit ist „Einwechseln ist eine Datei"
//      nicht nur behauptet, sondern nachgewiesen.
//
// Was die Hinterlegung ist, weiß dieses Skript nicht selbst: es liest sie aus
// der Seam-Datei. Ein Check, der sie wiederholt, wäre nach dem ersten Tausch
// grün und wirkungslos zugleich.
//
// Seit #514 stehen hinter den beiden Namen keine Ligaturen mehr, sondern
// eingebettete SVG-Literale. Die Tabelle führt nur noch Namen, die Zeichnungen
// sind eigene Konstanten — und der Check liest **beides**. Nur die Namen zu
// lesen reichte nicht: die Zeichnung ist die eigentliche Hinterlegung, und eine
// zweite Kopie von ihr in einer anderen Datei ist genau der Bruch, den diese
// Regel verhindert.
//
// Aufruf: `npm run check:icon-seam` (läuft auch in `npm test` und in der CI).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC_ROOT = join(FRONTEND_ROOT, 'src');

/** Die eine Stelle. Nur hier dürfen Namen und Zeichnungen stehen. */
const SEAM_FILE = join('src', 'app', 'shared', 'app-icons.ts');

/** Der Name der Tabelle in der Seam-Datei, die die Hinterlegungen trägt. */
const BACKING_TABLE = 'APP_ICON_BACKINGS';

/**
 * Wie viele Zeichen einer Zeichnung als Fingerabdruck dienen — und wie viele es
 * mindestens sein müssen, damit er einer ist. Kürzer wäre eine Zufallskollision
 * denkbar, länger würde an harmloser Umformatierung scheitern.
 */
const SIGNATURE_LENGTH = 60;
const SIGNATURE_MINIMUM = 24;

/**
 * Was heute hinter `app-icon-error` und `app-icon-empty` steckt — aus der
 * Seam-Datei **gelesen**, nicht hier wiederholt.
 *
 * Stünde die Hinterlegung auch hier, wäre „Einwechseln ist eine Datei" gelogen:
 * wer in `app-icons.ts` tauscht und dieses Skript vergisst, hätte danach einen
 * Check, der die alte Hinterlegung bewacht — grün, aber wirkungslos, weil die
 * neue überall stehen dürfte. Deshalb liest der Check die Tabelle und die
 * Zeichnungen; und wenn er sie nicht lesen kann, bricht er laut ab, statt still
 * nichts zu prüfen.
 *
 * @returns {{names: string[], signatures: string[]}}
 */
function readSeam() {
  const seamPath = join(FRONTEND_ROOT, SEAM_FILE);
  const source = readFileSync(seamPath, 'utf8');

  const table = source.match(new RegExp(`export const ${BACKING_TABLE}\\s*=\\s*\\{([^}]*)\\}`));
  const names = table ? [...table[1].matchAll(/:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]) : [];

  if (names.length < 2) {
    abort(
      `${SEAM_FILE} hat keine lesbare \`export const ${BACKING_TABLE} = { … }\`-Tabelle ` +
        `mit mindestens zwei benannten Hinterlegungen mehr.`,
    );
  }

  const drawings = [...source.matchAll(/const\s+[A-Z][A-Z0-9_]*\s*=\s*`\s*(<svg[\s\S]*?)`/g)].map(
    (m) => m[1],
  );
  const signatures = drawings.map(signature).filter((s) => s.length >= SIGNATURE_MINIMUM);

  if (signatures.length < 2) {
    abort(
      `${SEAM_FILE} hat keine zwei lesbaren SVG-Konstanten mit erkennbarer Geometrie mehr ` +
        `(erwartet: const NAME = <svg …> als mehrzeiliges Literal).`,
    );
  }

  return { names, signatures };
}

/**
 * Der Fingerabdruck einer Zeichnung: ihr erstes Stück Geometrie. Damit findet
 * der Check eine zweite Kopie auch dann, wenn sie anders eingerückt oder in
 * eine andere Hülle gepackt wurde — die Pfaddaten überleben beides.
 */
function signature(drawing) {
  const geometry = drawing.match(/\s(?:d|points)="([^"]+)"/);
  const inner = geometry
    ? geometry[1]
    : drawing
        .replace(/^<svg[^>]*>/, '')
        .replace(/\s+/g, ' ')
        .trim();
  return inner.slice(0, SIGNATURE_LENGTH);
}

/** Laut abbrechen — die einzige ehrliche Antwort auf eine unlesbare Naht. */
function abort(was) {
  console.error(
    `Icon-Seam-Check kaputt (#439):\n\n  ${was}\n  Der Check kann nicht raten, was er ` +
      `bewachen soll — und will lieber abbrechen als grün nichts prüfen.\n`,
  );
  process.exit(1);
}

const SEAM = readSeam();

/**
 * Was außer der Hinterlegung selbst nur in der Seam-Datei stehen darf: die
 * Tabelle. Wer sie woanders importiert, holt sich die Hinterlegung an der Naht
 * vorbei zurück.
 */
const SEAM_ONLY_NAMES = [...SEAM.names, BACKING_TABLE];

// Die Glyphen, die den leeren oder den kaputten Zustand tragen — plus die
// naheliegenden Griffe daneben, damit die Rolle nicht über einen Nachbarn
// zurückkommt. Seit #514 steht im Seam keine Ligatur mehr, diese Liste ist also
// die ganze Regel 1 und will gepflegt sein. Was im Seam hinterlegt ist, kommt
// weiterhin von dort dazu: ein Template, das den Namen der Hinterlegung als
// Ligatur schriebe, wäre derselbe Bruch. Bewusst NICHT dabei: `warning` (die
// Plausibilitätswarnung ist laut ADR 0037 keine Fehlerklasse) und `cloud_off`
// (der Offline-Zustand hat sein eigenes Idiom).
const ROLE_LIGATURES = [
  ...new Set([
    ...SEAM.names,
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
// hier ausdrücklich NICHT ausgenommen: eine Spec, die die Hinterlegung
// festnagelt, macht aus dem Einwechseln zwei Dateien statt einer — und ist
// obendrein die falsche Prüfung. Was eine Spec über den Seam wissen darf, ist
// *dass* etwas gezeichnet wird und dass leer und kaputt verschieden aussehen
// (siehe `app-icons.spec.ts` und `app-icons.testing.ts`), nie *was*.
for (const file of files.filter((f) => f.endsWith('.ts') || f.endsWith('.html'))) {
  const rel = relative(FRONTEND_ROOT, file);
  if (rel === SEAM_FILE.split(sep).join(sep)) continue;
  const source = readFileSync(file, 'utf8');
  const lines = source.split('\n');

  for (const name of SEAM_ONLY_NAMES) {
    const occurrence = new RegExp(`\\b${name}\\b`);
    if (!occurrence.test(source)) continue;
    const line = lines.findIndex((l) => occurrence.test(l)) + 1;
    failures.push(
      `${rel}:${line}: „${name}" gehört zur Hinterlegung des Icon-Seams und ` +
        `ausschließlich nach ${SEAM_FILE} — sonst ist „Einwechseln ist eine Datei" nicht wahr.`,
    );
  }

  for (const abdruck of SEAM.signatures) {
    if (!source.includes(abdruck)) continue;
    const line = lines.findIndex((l) => l.includes(abdruck)) + 1;
    failures.push(
      `${rel}:${line}: „${abdruck.slice(0, SIGNATURE_MINIMUM)}…" ist ein Stück der Zeichnung hinter dem ` +
        `Icon-Seam und gehört ausschließlich nach ${SEAM_FILE} — eine zweite Kopie macht aus ` +
        `dem Einwechseln zwei Dateien statt einer.`,
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
