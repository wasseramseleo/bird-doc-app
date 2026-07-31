#!/usr/bin/env node
// Das Vokabular der Oberfläche steht dort, wo es hingehört (#469, ADR 0040).
//
// Dieses Skript hält Regeln über *Wörter auf dem Bildschirm*. Es beginnt mit
// einer, und es ist als Liste gebaut, weil die zweite schon feststeht: ADR 0040
// bindet die Ansprache („Beringer:in" in der App-Oberfläche) und zieht hier
// direkt neben der ersten ein.
//
// ── Regel „ringstatus" ──────────────────────────────────────────────────────
//
// Fünf Oberflächen zeigten denselben Fang-Status an, und alle fünf trugen
// dieselbe kopierte Ternäre:
//
//     bird_status === BirdStatus.FirstCatch ? 'Erstfang' : 'Wiederfang'
//
// Das ist nicht bloß Wiederholung, sondern eine Falschaussage: das Paar ist
// **nicht erschöpfend** (CONTEXT.md, Glossar „Erstfang / Wiederfang"). Ein
// *Ring vernichtet* ist keines von beidem — sein Ringstatus gehört zu den
// Vogeldaten, die das Backend vorsätzlich leert —, und der `else`-Zweig
// behauptete für ihn einen Wiederfang, also eine Tatsache, die absichtlich
// gelöscht worden war. Genau ein Ort macht deshalb aus einem Ringstatus ein
// Wort: `src/app/data-entry-form/data-entry-labels.ts`, neben den Funktionen
// für Alter und Geschlecht, die dort aus demselben Grund schon liegen.
//
// **Wo die Regel gezogen ist, und warum dort:** verboten ist eine
// Zeichenkette, deren **ganzer Wert** `Erstfang` oder `Wiederfang` ist — das
// kopierte Etikett selbst. Alles Längere bleibt erlaubt, denn es ist etwas
// anderes:
//
//   * `'Wiederfang (w)'` — die Beschriftung der Ringstatus-Auswahl im
//     Erfassungsformular. Sie *setzt* den Wert, sie liest ihn nicht ab; sie
//     trägt den Tastaturkürzel-Buchstaben und ist kein Zellinhalt.
//   * `'Als Wiederfang erfassen'` — die Abhilfe aus #444 im Fehler-Banner. Ein
//     Satz auf einer Schaltfläche, keine Statusanzeige.
//
// Eine Liste dieser beiden Einzelfälle wäre binnen eines Monats eine Liste von
// zehn. Die Länge trennt sie stattdessen strukturell: wer das Etikett kopiert,
// kopiert es blank, und genau das schlägt hier an.
//
// Ausgenommen, weil dort kein Wort auf einen Bildschirm gelangt:
//
//   * **Tests** — `*.spec.ts` unter `src` prüfen ja gerade, *dass* das richtige
//     Wort erscheint, und `e2e/` wird gar nicht erst betreten.
//   * **Code-Bezeichner** — `onAlsWiederfang`, `KollidierenderErstfang`,
//     `chip-erstfang`. Sie stehen in keiner Zeichenkette und fallen damit von
//     selbst heraus.
//   * **Kommentare** — in `.ts` wie in `.html` maskiert, bevor gesucht wird.
//   * **Dokumentation** — `CONTEXT.md`, `docs/adr/`, `CLAUDE.md` liegen
//     außerhalb von `frontend/src`.
//
// Aufruf: `npm run check:vokabular` (läuft auch in `npm test` und in der CI).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC_ROOT = join(FRONTEND_ROOT, 'src');

/** Das geteilte Beschriftungsmodul — der eine Ort, der die Wörter tragen darf. */
const BESCHRIFTUNGSMODUL = 'src/app/data-entry-form/data-entry-labels.ts';

/**
 * Die Regeln dieses Skripts. Jede beschreibt sich selbst:
 *
 *   `id`        — kurzer Name für die Fehlerausgabe.
 *   `titel`     — die Überschrift, unter der ihre Verletzungen erscheinen.
 *   `gilt`      — für welche Datei (repo-relativer Pfad) sie überhaupt prüft.
 *   `muster`    — worauf sie anschlägt, je Zeile geprüft.
 *   `meldung`   — was der Verletzer stattdessen tun soll.
 *   `bestanden` — der Satz, mit dem sie ihr Schweigen begründet.
 *
 * Eine zweite Regel ist eine weitere Eintragung in dieser Liste, sonst nichts.
 */
const REGELN = [
  {
    id: 'ringstatus',
    titel: 'Der Ringstatus wird außerhalb des Beschriftungsmoduls zu einem Wort (#469)',
    gilt: (rel) => rel !== BESCHRIFTUNGSMODUL,
    muster: [/(['"`])(Erstfang|Wiederfang)\1/],
    meldung: (rel, zeile) =>
      `${rel}:${zeile}: „Erstfang"/„Wiederfang" als blankes Etikett — der ` +
      `Ringstatus wird an genau einem Ort zu einem Wort. Nimm ` +
      `\`getBirdStatusLabel\` aus ${BESCHRIFTUNGSMODUL}; es liefert bei ` +
      `fehlendem Ringstatus einen Gedankenstrich, weil ein Ring vernichtet ` +
      `weder Erstfang noch Wiederfang ist.`,
    bestanden: (anzahl) =>
      `Der Ringstatus wird an genau einem Ort zu einem Wort: ${anzahl} Dateien ` +
      `geprüft, keine Ausnahme.`,
  },
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

/**
 * Derselbe Quelltext, in dem jeder Kommentarinhalt durch Leerzeichen ersetzt
 * wurde. Zeilenumbrüche bleiben stehen, die Zeilennummern stimmen also weiter.
 *
 * Zeichenketten werden dabei übersprungen, nicht geleert — ein `//` in einem
 * Pfad („https://…") oder ein `<!--` in einem Satz beginnt sonst einen
 * Kommentar, der bis ans Dateiende reicht und den Rest der Datei blind macht.
 */
function maskiereKommentare(source, html) {
  const out = source.split('');
  const blank = (from, to) => {
    for (let i = from; i <= to && i < source.length; i += 1) {
      if (source[i] !== '\n') out[i] = ' ';
    }
  };

  let i = 0;
  while (i < source.length) {
    const char = source[i];

    if (html && source.startsWith('<!--', i)) {
      const close = source.indexOf('-->', i + 4);
      const end = close === -1 ? source.length - 1 : close + 2;
      blank(i, end);
      i = end + 1;
      continue;
    }
    if (!html && char === '/' && source[i + 1] === '/') {
      let end = source.indexOf('\n', i);
      if (end === -1) end = source.length;
      blank(i, end - 1);
      i = end;
      continue;
    }
    if (!html && char === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2);
      const end = close === -1 ? source.length - 1 : close + 1;
      blank(i, end);
      i = end + 1;
      continue;
    }
    if (char === '\'' || char === '"' || char === '`') {
      i = stringEnd(source, i) + 1;
      continue;
    }
    i += 1;
  }
  return out.join('');
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

const verletzungen = new Map(REGELN.map((regel) => [regel.id, []]));
const geprueft = new Map(REGELN.map((regel) => [regel.id, 0]));
const files = walk(SRC_ROOT);

for (const file of files) {
  const rel = relative(FRONTEND_ROOT, file).split('\\').join('/');
  if (rel.endsWith('.spec.ts')) continue;

  const lines = maskiereKommentare(readFileSync(file, 'utf8'), rel.endsWith('.html')).split('\n');

  for (const regel of REGELN) {
    if (!regel.gilt(rel)) continue;
    geprueft.set(regel.id, geprueft.get(regel.id) + 1);
    lines.forEach((line, index) => {
      if (regel.muster.some((muster) => muster.test(line))) {
        verletzungen.get(regel.id).push(regel.meldung(rel, index + 1));
      }
    });
  }
}

let gefallen = 0;
for (const regel of REGELN) {
  const gefunden = verletzungen.get(regel.id);
  if (gefunden.length === 0) continue;
  gefallen += gefunden.length;
  console.error(`${regel.titel}:\n`);
  for (const verletzung of gefunden) console.error(`  ${verletzung}`);
  console.error('');
}

if (gefallen > 0) {
  console.error(`${gefallen} Verletzung(en).`);
  process.exit(1);
}

for (const regel of REGELN) {
  console.log(regel.bestanden(geprueft.get(regel.id)));
}
