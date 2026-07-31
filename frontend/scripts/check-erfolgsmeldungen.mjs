#!/usr/bin/env node
// Eine Snackbar bestätigt nur noch Gelungenes (#448, ADR 0037, User Story 28).
//
// „Snackbars bestätigen; sie erklären nie einen Fehlschlag." Eine flüchtige
// Meldung darf sagen, dass etwas *gelungen* ist, sonst nichts. Jeder Fehlschlag
// bekommt eine Oberfläche, die bleibt, bis er behandelt ist — das Banner für die
// ausgelöste Schreibung (`shared/failure-banner`), den In-Place-Zustand für ein
// gescheitertes Laden (`shared/load-failure`). Nichts, worauf reagiert werden
// muss, verfällt nach drei Sekunden, während ein Mitglied beide Hände am Vogel
// hat.
//
// Vor #448 gab es 56 `snackBar.open`-Aufrufe in zehn Dateien und keine Regel
// darüber, was eine Snackbar tragen darf. Die Regel ist **ohne Kenntnis der
// Taxonomie prüfbar** — genau deshalb steht sie hier und nicht in einem
// Versprechen.
//
// Drei Regeln, repo-weit über `frontend/src` geprüft:
//
//   1. **Die Meldung steht im Quelltext.** Das erste Argument von
//      `snackBar.open(…)` trägt mindestens eine Zeichenketten- oder
//      Template-Literale. Wer den Text hinter einer Variablen oder einem
//      Funktionsaufruf versteckt, entzieht ihn Regel 2 — und genau so sahen die
//      alten Fehlschlag-Snackbars aus (`this.errorMessage(err, 'gespeichert')`).
//      Das deckt zugleich User Story 32 für diese Oberfläche ab: eine Meldung,
//      die erst aus einem HTTP-Status zusammengebaut wird, steht nicht im
//      Quelltext. Für jede *andere* Meldung besorgt das die Schwesterprüfung
//      `check-transport-strings.mjs` (#443), die unverändert daneben läuft.
//   2. **Keine dieser Zeichenketten erklärt einen Fehlschlag.** Geprüft wird
//      gegen Wendungen, nicht gegen Wörter: „konnte nicht", „fehlgeschlagen",
//      „nicht möglich". Das Wort „Fehler" allein ist bewusst **keine** davon —
//      „2 mit Fehler markiert" im Sync-Bericht benennt dauerhaften Zustand, den
//      die Outbox-Oberfläche trägt, und erklärt keinen Fehlschlag.
//   3. **Keine Snackbar in einem `error`-Zweig.** Die Regel, die auch dann
//      greift, wenn die Worte harmlos klingen: was im Fehlerpfad eines
//      `subscribe({… error: …})` oder eines `catchError(…)` steht, ist ein
//      Fehlschlag, ganz gleich wie er formuliert ist.
//
// Aufruf: `npm run check:erfolgsmeldungen` (läuft auch in `npm test` und in der CI).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC_ROOT = join(FRONTEND_ROOT, 'src');

/**
 * Wendungen, die einen Fehlschlag erklären. Bewusst Wendungen und keine Wörter:
 * eine Liste aus „Fehler", „nicht" und „leer" schlüge auf „Keine früheren
 * Einträge für diesen Ring gefunden." an — ein Ergebnis, kein Fehlschlag — und
 * wäre binnen einer Woche mit Ausnahmen zugestellt.
 *
 * Es gibt hier **keine** Ausnahmeliste. Wer eine Verletzung erlauben will, muss
 * die Meldung auf eine der beiden bleibenden Oberflächen umziehen; das ist der
 * ganze Punkt.
 */
const FEHLSCHLAG_WENDUNGEN = [
  /\bkonnten? nicht\b/i,
  /\bfehlgeschlagen\b/i,
  /\bgescheitert\b/i,
  /\bschiefgelaufen\b/i,
  /\bnicht m(ö|oe)glich\b/i,
  /\bnicht erreichbar\b/i,
  /\babgelehnt\b/i,
  /\bzur(ü|ue)ckgewiesen\b/i,
  /\bFehler beim\b/i,
  /\bist ein Fehler aufgetreten\b/i,
  /\bleider\b/i,
];

/** `something…snack….open(` — der Empfänger heißt nach dem, was er öffnet. */
const SNACKBAR_OPEN = /(^|[^\w$])([\w$]*[sS]nack[\w$]*)\.open\s*\(/g;

/** Wo ein Fehlschlag behandelt wird: der `error`-Zweig und `catchError(…)`. */
const ERROR_HANDLER = /(^|[^\w$])(error\s*:|catchError\s*\()/g;

/** Wonach ein `/` eine Regex beginnt und keine Division ist. */
const BEFORE_REGEX = new Set([
  '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^',
  '<', '>', '',
]);

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...walk(full));
    } else if (full.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

/** Der Index des schließenden Anführungszeichens, Escapes berücksichtigt. */
function stringEnd(source, start) {
  const quote = source[start];
  for (let i = start + 1; i < source.length; i += 1) {
    if (source[i] === '\\') {
      i += 1;
      continue;
    }
    if (source[i] === quote) {
      return i;
    }
  }
  return source.length - 1;
}

/**
 * Derselbe Quelltext, in dem alles, was **kein Code** ist, durch Leerzeichen
 * ersetzt wurde: Kommentarinhalte, Zeichenketteninhalte, Regex-Inhalte. Länge
 * und Zeilenumbrüche bleiben, jeder Index zeigt also weiter auf dieselbe Stelle
 * im Original; die Anführungszeichen selbst bleiben stehen, damit die Literale
 * danach noch zu finden sind.
 *
 * Ohne das zählt dieses Skript Klammern in Kommentaren mit, hält ein Apostroph
 * in „the entry's" für den Beginn einer Zeichenkette und rutscht mit den
 * `error`-Bereichen quer durch die Datei — beim ersten Anlauf hat es genau das
 * getan und drei Erfolgsmeldungen als Fehlschläge gemeldet.
 */
function maskNonCode(source) {
  const out = source.split('');
  const blank = (from, to) => {
    for (let i = from; i <= to && i < source.length; i += 1) {
      if (source[i] !== '\n') out[i] = ' ';
    }
  };

  let previous = '';
  let i = 0;
  while (i < source.length) {
    const char = source[i];

    if (char === '/' && source[i + 1] === '/') {
      let end = source.indexOf('\n', i);
      if (end === -1) end = source.length;
      blank(i, end - 1);
      i = end;
      continue;
    }
    if (char === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2);
      const end = close === -1 ? source.length - 1 : close + 1;
      blank(i, end);
      i = end + 1;
      continue;
    }
    if (char === '\'' || char === '"' || char === '`') {
      const end = stringEnd(source, i);
      blank(i + 1, end - 1);
      i = end + 1;
      previous = char;
      continue;
    }
    if (char === '/' && BEFORE_REGEX.has(previous)) {
      let j = i + 1;
      let inClass = false;
      while (j < source.length && source[j] !== '\n') {
        if (source[j] === '\\') {
          j += 2;
          continue;
        }
        if (source[j] === '[') inClass = true;
        else if (source[j] === ']') inClass = false;
        else if (source[j] === '/' && !inClass) break;
        j += 1;
      }
      blank(i, Math.min(j, source.length - 1));
      i = j + 1;
      previous = '/';
      continue;
    }
    if (!/\s/.test(char)) previous = char;
    i += 1;
  }
  return out.join('');
}

/**
 * Anfang und Ende des ersten Arguments — vom `(` bis zum ersten Komma auf
 * oberster Ebene oder bis zur schließenden Klammer. Gezählt wird auf dem
 * maskierten Text, damit ein Komma *in* einem Satz das Argument nicht beendet.
 */
function firstArgumentRange(masked, openParenIndex) {
  let depth = 0;
  for (let i = openParenIndex; i < masked.length; i += 1) {
    const char = masked[i];
    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      continue;
    }
    if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
      if (depth === 0) return [openParenIndex + 1, i];
      continue;
    }
    if (char === ',' && depth === 1) return [openParenIndex + 1, i];
  }
  return [openParenIndex + 1, masked.length];
}

/** Die Zeichenketten- und Template-Literale eines Bereichs, im Klartext. */
function literalsIn(source, masked, from, to) {
  const literals = [];
  for (let i = from; i < to; i += 1) {
    const char = masked[i];
    if (char !== '\'' && char !== '"' && char !== '`') continue;
    const end = stringEnd(masked, i);
    literals.push(source.slice(i + 1, end));
    i = end;
  }
  return literals;
}

/**
 * Die Bereiche, in denen ein Fehlschlag behandelt wird. Ab dem `error:` bzw. dem
 * `catchError(` wird vorwärts geklammert; der Bereich endet, wo der Wert endet —
 * am Komma oder an der schließenden Klammer der Ebene, auf der er begann.
 */
function errorHandlerRanges(masked) {
  const ranges = [];
  ERROR_HANDLER.lastIndex = 0;
  let match;
  while ((match = ERROR_HANDLER.exec(masked)) !== null) {
    const start = match.index + match[0].length;
    let depth = 0;
    let i = start;
    for (; i < masked.length; i += 1) {
      const char = masked[i];
      if (char === '(' || char === '[' || char === '{') {
        depth += 1;
        continue;
      }
      if (char === ')' || char === ']' || char === '}') {
        if (depth === 0) break;
        depth -= 1;
        continue;
      }
      if (char === ',' && depth === 0) break;
    }
    ranges.push([start, i]);
  }
  return ranges;
}

const failures = [];
const files = walk(SRC_ROOT);

for (const file of files) {
  const rel = relative(FRONTEND_ROOT, file).split('\\').join('/');
  // Specs dürfen den Fehlschlag benennen — sie prüfen ja gerade, dass er *nicht*
  // in einer Snackbar landet.
  if (rel.endsWith('.spec.ts')) continue;

  const source = readFileSync(file, 'utf8');
  const masked = maskNonCode(source);
  const ranges = errorHandlerRanges(masked);
  const lineAt = (index) => source.slice(0, index).split('\n').length;

  SNACKBAR_OPEN.lastIndex = 0;
  let match;
  while ((match = SNACKBAR_OPEN.exec(masked)) !== null) {
    const callIndex = match.index + match[0].length - 1;
    const line = lineAt(callIndex);
    const [from, to] = firstArgumentRange(masked, callIndex);
    const literals = literalsIn(source, masked, from, to);

    if (literals.length === 0) {
      failures.push(
        `${rel}:${line}: die Meldung steht nicht im Quelltext — eine Snackbar ` +
          `trägt einen Satz, keinen Ausdruck, der erst zur Laufzeit einer wird.`,
      );
    }

    for (const literal of literals) {
      if (!FEHLSCHLAG_WENDUNGEN.some((pattern) => pattern.test(literal))) continue;
      failures.push(
        `${rel}:${line}: „${literal.trim().slice(0, 60)}" erklärt einen Fehlschlag — ` +
          `eine Snackbar bestätigt nur Gelungenes. Nimm <app-failure-banner> ` +
          `(ausgelöste Schreibung) oder <app-load-failure> (gescheitertes Laden).`,
      );
    }

    if (ranges.some(([start, end]) => callIndex >= start && callIndex < end)) {
      failures.push(
        `${rel}:${line}: eine Snackbar im \`error\`-Zweig — was dort steht, ist ein ` +
          `Fehlschlag, wie harmlos er auch klingt. Er gehört auf eine Oberfläche, ` +
          `die bleibt, bis er behandelt ist.`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error('Fehlschläge in der Snackbar (#448, ADR 0037):\n');
  for (const failure of failures) console.error(`  ${failure}`);
  console.error(`\n${failures.length} Verletzung(en).`);
  process.exit(1);
}

console.log(
  `Snackbars bestätigen nur Gelungenes: ${files.length} Dateien geprüft, keine Ausnahme.`,
);
