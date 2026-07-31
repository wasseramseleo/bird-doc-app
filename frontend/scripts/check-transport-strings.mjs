#!/usr/bin/env node
// Kein Bauteil baut eine Meldung aus dem Transport (#443, ADR 0037, User Story 32).
//
// Der Defekt, mit dem PRD #438 anfing, war genau eine Zeile:
//
//     this.snackBar.open(`Fehler beim Speichern: ${err.message}`, 'Schließen');
//
// `HttpErrorResponse.message` ist die Zeichenkette des Transports — „Http failure
// response for https://app.birddoc.eu/api/birds/data-entries/: 400 OK". Sie sagt
// einem Beringer mit einem Vogel in der Hand nichts, und sie verdrängte den
// präzisen deutschen Satz, den der Server längst mitgeschickt hatte. Dasselbe
// gilt für den nackten Status in einer Meldung.
//
// Zwei Regeln, repo-weit über `frontend/src` geprüft:
//
//   1. Niemand liest `.message` von einem Fehler.
//   2. Niemand schreibt einen HTTP-Status in eine Meldung.
//
// Der Ausweg ist derselbe wie überall sonst: `appFailureOf(error).text` — der
// Satz des Servers, und wo keiner kam, der deutsche Ersatzsatz der Fehlerklasse
// (`core/errors/app-failure.ts`).
//
// Aufruf: `npm run check:transport-strings` (läuft auch in `npm test` und in der CI).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC_ROOT = join(FRONTEND_ROOT, 'src');

/**
 * Was noch nicht umgestellt ist — mit der Scheibe, die es abräumt.
 *
 * Bewusst eine Liste einzelner Dateien und keine Ordner: sie wird kleiner,
 * nie größer. Wer hier etwas hinzufügt, verschiebt eine Entscheidung, die
 * PRD #438 bereits getroffen hat.
 */
const NOT_YET = new Map([
  [
    'src/app/service/sync.service.ts',
    'extractServerMessage — der fünfte handgeschriebene Extraktor, eingezogen in #445',
  ],
]);

/** Etwas, das nach einem Fehler heißt, nach seiner `.message` gefragt. */
const TRANSPORT_MESSAGE =
  /(^|[^A-Za-z0-9_.])(err|error|failure|reason|e)[A-Za-z0-9_]*\.message\b/;

/** Ein Status, der in eine Zeichenkette wandert — `${…status…}` oder `' … ' + status`. */
const STATUS_IN_MESSAGE = [
  /\$\{[^}]*\bstatus\b[^}]*\}/,
  /['"`][^'"`]*['"`]\s*\+\s*[A-Za-z0-9_.]*\bstatus\b/,
];

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...walk(full));
    } else if (full.endsWith('.ts') || full.endsWith('.html')) {
      files.push(full);
    }
  }
  return files;
}

const failures = [];
const files = walk(SRC_ROOT);

for (const file of files) {
  const rel = relative(FRONTEND_ROOT, file).split('\\').join('/');
  // Specs dürfen den Transport benennen — sie prüfen ja gerade, dass er
  // *nicht* auf dem Bildschirm landet.
  if (rel.endsWith('.spec.ts')) continue;
  if (NOT_YET.has(rel)) continue;

  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    const stripped = line.replace(/^\s*(\/\/|\*|\/\*).*$/, '');
    if (TRANSPORT_MESSAGE.test(stripped)) {
      failures.push(
        `${rel}:${index + 1}: liest die Transportzeichenkette eines Fehlers ` +
          `(\`.message\`) — nimm \`appFailureOf(error).text\`.`,
      );
    }
    if (STATUS_IN_MESSAGE.some((pattern) => pattern.test(stripped))) {
      failures.push(
        `${rel}:${index + 1}: baut eine Meldung aus einem HTTP-Status — ` +
          `ein Bauteil bekommt die Fehlerklasse, nie den Status.`,
      );
    }
  });
}

if (failures.length > 0) {
  console.error('Transportzeichenketten auf dem Bildschirm (#443, ADR 0037):\n');
  for (const failure of failures) console.error(`  ${failure}`);
  console.error(`\n${failures.length} Verletzung(en).`);
  process.exit(1);
}

console.log(
  `Keine Transportzeichenkette in einer Meldung: ${files.length} Dateien geprüft, ` +
    `${NOT_YET.size} noch offen (${[...NOT_YET.keys()].join(', ')}).`,
);
