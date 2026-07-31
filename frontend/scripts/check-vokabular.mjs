#!/usr/bin/env node
// Das Vokabular der Oberfläche steht dort, wo es hingehört (#469, #470, ADR 0040).
//
// Dieses Skript hält Regeln über *Wörter auf dem Bildschirm*. Es ist als Liste
// gebaut, weil eine Regel selten allein bleibt: die erste kam mit #469, die
// zweite mit #470 direkt daneben.
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
// ── Regel „ansprache" ───────────────────────────────────────────────────────
//
// ADR 0040 gibt derselben Person vier Schreibweisen, jede mit ihrem
// Geltungsbereich — und diese Regel hält die eine fest, die man beim Tippen
// vergisst: **die App-Oberfläche schreibt `Beringer:in` / `Beringer:innen`**.
// Das nackte generische Maskulinum stand an 79 Stellen; eine Assertion je
// Stelle hätte die 80ste nicht verhindert.
//
// Erlaubt bleiben die drei anderen Schreibweisen — sie sind keine Nachlässigkeit,
// sondern je eine Entscheidung:
//
//   * `BeringerIn` — die Spaltenüberschrift der IWM-Meldedatei. Dateiformat,
//     keine Sprachentscheidung: die Meldestelle setzt es, nicht wir.
//   * `Beringerinnen und Beringer` — die **Paarform** der öffentlichen Prosa.
//     Sie erfüllt das Ziel bereits und ist für Screenreader die sauberste Form.
//     Erkannt daran, dass in derselben Zeile eine Femininform steht.
//   * `Beringerin` — das generische Femininum des Wissen-Glossars.
//
// Ebenfalls erlaubt, weil es kein allein stehendes Maskulinum ist: das
// **Bestimmungswort einer Zusammensetzung** (`Beringer-Eintrag`,
// `Beringer-Liste`, `Beringer-Kürzel`). Deutsche Komposita tragen die Kurzform,
// und `Beringer:innen-Eintrag` wäre eine Verschlechterung, keine Ansprache.
//
// **Wo die Regel nicht hinreicht, und warum:** sie prüft Oberflächentext, also
// Angular-Templates, deren Zeichenketten, die übersetzten Servermeldungen und
// die Landing-Templates. Ausdrücklich **nicht** geprüft — ADR 0040 nimmt sie
// namentlich aus:
//
//   * **Domäne, Modell, Endpunkt, Formularfeld** — `models.py` und die
//     Migrationen bleiben `Beringer`; dieses ADR ändert Sprache, keine
//     Struktur. `admin.py` liegt aus demselben Grund daneben wie die
//     IWM-Datei: seine `Beringer(in)`-Spalte ist die Überschrift einer
//     CSV-Ausfuhr, also ein Dateiformat.
//   * **Verwaltungsbefehle** (`management/commands/`) — sie schreiben in ein
//     Terminal, nicht auf eine Oberfläche, und legen Testdaten an, in denen
//     „Beringer" auch schlicht ein Nachname sein darf.
//   * **Rechtstexte** (`agb.html`, `datenschutz.html`, `impressum.html`) — sie
//     schreiben ohnehin die Paarform, und niemand hat gebeten, sie anzufassen.
//   * **Wissen-Glossar** (`glossar*.html`, `wissen*.html`, `glossar.py`,
//     `wissen.py`) — es richtet sich laut CONTEXT.md ausdrücklich auch an
//     Maschinenleser; ein Doppelpunkt im Wort macht eine zitierfähige Referenz
//     dort schlechter, nicht besser.
//   * **Code-Bezeichner** — `BeringerComponent`, `createdBeringer`,
//     `pendingBeringer`. Sie tragen das Wort mitten im Bezeichner und fallen
//     schon an den Wortgrenzen heraus.
//   * **Kommentare und Docstrings** — maskiert, bevor gesucht wird. Ein
//     Python-Docstring *ist* eine Zeichenkette, aber Dokumentation, kein Text
//     auf einem Bildschirm.
//   * **Diagnosen** — `console.…` und `new Error(…)` erscheinen in der Konsole,
//     nie auf der Oberfläche.
//
// Ausgenommen, weil dort kein Wort auf einen Bildschirm gelangt:
//
//   * **Tests** — `*.spec.ts` unter `src` und `backend/**/tests/` prüfen ja
//     gerade, *dass* das richtige Wort erscheint; `e2e/` wird gar nicht erst
//     betreten.
//   * **Code-Bezeichner** — `onAlsWiederfang`, `KollidierenderErstfang`,
//     `chip-erstfang`. Sie stehen in keiner Zeichenkette und fallen damit von
//     selbst heraus.
//   * **Kommentare** — in `.ts`, `.html` (auch `{% comment %}`) wie in `.py`
//     maskiert, bevor gesucht wird.
//   * **Dokumentation** — `CONTEXT.md`, `docs/adr/`, `CLAUDE.md` liegen
//     außerhalb der geprüften Wurzeln.
//
// Aufruf: `npm run check:vokabular` (läuft auch in `npm test` und in der CI).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC_ROOT = join(FRONTEND_ROOT, 'src');
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BACKEND_ROOT = join(REPO_ROOT, 'backend');

/** Das geteilte Beschriftungsmodul — der eine Ort, der die Wörter tragen darf. */
const BESCHRIFTUNGSMODUL = 'src/app/data-entry-form/data-entry-labels.ts';

/**
 * Eine Quellenmenge: welche Bäume durchlaufen werden, welche Endungen zählen,
 * gegen welche Basis die gemeldeten Pfade stehen und was davon Test ist.
 *
 * Eine Regel nennt ihre Quellen selbst — die Ringstatus-Regel sucht nur im
 * Frontend, die Ansprache-Regel auch im Django-Backend, weil ein Mitglied
 * dessen Meldungen genauso liest wie eine Beschriftung.
 */
const FRONTEND_QUELLE = {
  basis: FRONTEND_ROOT,
  wurzeln: [SRC_ROOT],
  endungen: ['.ts', '.html'],
  istTest: (rel) => rel.endsWith('.spec.ts'),
};

const BACKEND_QUELLE = {
  basis: REPO_ROOT,
  wurzeln: [join(BACKEND_ROOT, 'birds'), join(BACKEND_ROOT, 'landing')],
  endungen: ['.py', '.html'],
  istTest: (rel) =>
    rel.includes('/tests/') ||
    basename(rel).startsWith('test_') ||
    basename(rel) === 'conftest.py',
};

/**
 * Ein allein stehendes generisches `Beringer` — der Anlass von ADR 0040.
 *
 * Die Wortgrenzen sind der ganze Trick. Vorn schließt der Rückblick jeden
 * Bezeichner aus, der das Wort in sich trägt (`createdBeringer`,
 * `pendingBeringer`). Hinten fallen `BeringerIn`, `Beringerin(nen)` schon an
 * der Buchstabenfolge heraus, `Beringer:in(nen)` am Doppelpunkt und das
 * Bestimmungswort einer Zusammensetzung am Bindestrich. Übrig bleibt genau
 * das nackte Wort — auch dekliniert (`Beringern`, `Beringers`).
 */
const WORTZEICHEN = 'A-Za-zÄÖÜäöüß0-9_';
const NACKTES_BERINGER = new RegExp(
  `(?<![${WORTZEICHEN}])Beringer[ns]?(?![${WORTZEICHEN}]|:in|-[${WORTZEICHEN}])`,
);

/** Trägt die Zeile bereits eine Femininform, ist ihr Maskulinum die Paarform. */
const PAARFORM = /Beringerin/;

/** Konsole und `Error` sind Diagnosen — sie erreichen keinen Bildschirm. */
const DIAGNOSE = /console\.|new Error\(/;

/**
 * Die Bereiche, die ADR 0040 namentlich unangetastet lässt: Modell und
 * CSV-Ausfuhr (Struktur und Dateiformat, nicht Sprache), die Verwaltungsbefehle,
 * die Rechtstexte und das Wissen.
 */
const AUSGENOMMEN = [
  /\/(models|admin)\.py$/,
  /\/migrations\//,
  /\/management\/commands\//,
  /\/(agb|datenschutz|impressum)\.html$/,
  /\/(glossar|wissen)[^/]*\.(html|py)$/,
  /\/_wissen[^/]*\.html$/,
];

/**
 * Die Regeln dieses Skripts. Jede beschreibt sich selbst:
 *
 *   `id`        — kurzer Name für die Fehlerausgabe.
 *   `titel`     — die Überschrift, unter der ihre Verletzungen erscheinen.
 *   `quellen`   — welche Bäume sie überhaupt durchläuft.
 *   `sicht`     — was sie von einer Datei zu sehen bekommt: `quelltext`
 *                 (alles außer Kommentaren) oder `oberflaeche` (nur, was auf
 *                 einem Bildschirm landen kann — Vorlagentext und
 *                 Zeichenketten, ohne Docstrings).
 *   `gilt`      — für welche Datei (pfad-relativ zur Basis) sie prüft.
 *   `erlaubt`   — welche Zeile sie trotz Treffers durchlässt. Sie bekommt die
 *                 **rohe** Zeile, nicht die maskierte: woran eine Ausnahme
 *                 kenntlich ist (`console.…`), steht gerade außerhalb der
 *                 Zeichenkette, die den Treffer trägt.
 *   `muster`    — worauf sie anschlägt, je Zeile geprüft.
 *   `meldung`   — was der Verletzer stattdessen tun soll.
 *   `bestanden` — der Satz, mit dem sie ihr Schweigen begründet.
 *
 * Eine dritte Regel ist eine weitere Eintragung in dieser Liste, sonst nichts.
 */
const REGELN = [
  {
    id: 'ringstatus',
    titel: 'Der Ringstatus wird außerhalb des Beschriftungsmoduls zu einem Wort (#469)',
    quellen: [FRONTEND_QUELLE],
    sicht: 'quelltext',
    gilt: (rel) => rel !== BESCHRIFTUNGSMODUL,
    erlaubt: () => false,
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
  {
    id: 'ansprache',
    titel: 'Die Oberfläche spricht mit nacktem generischem „Beringer" an (#470)',
    quellen: [FRONTEND_QUELLE, BACKEND_QUELLE],
    sicht: 'oberflaeche',
    gilt: (rel) => !AUSGENOMMEN.some((muster) => muster.test(`/${rel}`)),
    erlaubt: (zeile) => PAARFORM.test(zeile) || DIAGNOSE.test(zeile),
    muster: [NACKTES_BERINGER],
    meldung: (rel, zeile) =>
      `${rel}:${zeile}: nacktes generisches „Beringer" in Oberflächentext — ` +
      `die App spricht diese Person als „Beringer:in" / „Beringer:innen" an ` +
      `(ADR 0040), samt Deklination von Artikel und Adjektiv („Unbekannte:r ` +
      `Beringer:in", „eine:n Beringer:in"). Erlaubt bleiben die IWM-Spalte ` +
      `\`BeringerIn\`, die Paarform „Beringerinnen und Beringer" der ` +
      `öffentlichen Prosa, das generische Femininum des Wissen-Glossars und ` +
      `das Bestimmungswort einer Zusammensetzung („Beringer-Eintrag").`,
    bestanden: (anzahl) =>
      `Die Oberfläche schreibt Beringer:in: ${anzahl} Dateien geprüft, kein ` +
      `nacktes generisches Maskulinum.`,
  },
];

function walk(dir, endungen) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...walk(full, endungen));
    } else if (endungen.some((endung) => full.endsWith(endung))) {
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
    // Django-Vorlagen kommentieren mit `{% comment %}…{% endcomment %}` und
    // `{# … #}`. Angular-Vorlagen kennen beides nicht, die Behandlung schadet
    // dort also nichts.
    if (html && source.startsWith('{% comment %}', i)) {
      const close = source.indexOf('{% endcomment %}', i);
      const end = close === -1 ? source.length - 1 : close + '{% endcomment %}'.length - 1;
      blank(i, end);
      i = end + 1;
      continue;
    }
    if (html && source.startsWith('{#', i)) {
      const close = source.indexOf('#}', i + 2);
      const end = close === -1 ? source.length - 1 : close + 1;
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

/** Ein Gerüst aus Leerzeichen, in das nur Sichtbares zurückgeschrieben wird. */
function leeresGeruest(source) {
  const out = new Array(source.length);
  for (let i = 0; i < source.length; i += 1) {
    out[i] = source[i] === '\n' ? '\n' : ' ';
  }
  return out;
}

/**
 * Nur die Zeichenketten eines TypeScript-Quelltexts, alles andere geleert.
 *
 * Das ist die Umkehrung von `maskiereKommentare` und der Grund, warum
 * Typnamen wie `Beringer[]` oder `signal<Beringer[]>` die Ansprache-Regel
 * nicht auslösen: sie stehen in keiner Zeichenkette. Der Quelltext kommt
 * bereits kommentarfrei herein, sonst würde ein Apostroph in einem Kommentar
 * („don't") eine Zeichenkette eröffnen.
 */
function nurZeichenketten(source) {
  const out = leeresGeruest(source);
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (char === '\'' || char === '"' || char === '`') {
      const ende = stringEnd(source, i);
      for (let k = i; k <= ende && k < source.length; k += 1) {
        if (source[k] !== '\n') out[k] = source[k];
      }
      i = ende + 1;
      continue;
    }
    i += 1;
  }
  return out.join('');
}

/** Das Ende eines Python-Literals mit dem gegebenen Begrenzer. */
function pythonStringEnd(source, start, begrenzer) {
  let i = start + begrenzer.length;
  while (i < source.length) {
    if (source[i] === '\\') {
      i += 2;
      continue;
    }
    if (source.startsWith(begrenzer, i)) return i + begrenzer.length - 1;
    i += 1;
  }
  return source.length - 1;
}

/**
 * Nur die *einfachen* Zeichenketten eines Python-Quelltexts.
 *
 * Dreifach begrenzte Literale fallen mit heraus: sie sind in diesem Backend
 * ausnahmslos Docstrings, also Dokumentation — und Dokumentation bleibt laut
 * ADR 0040 bei `Beringer`. `#`-Kommentare werden gleich mit übersprungen,
 * wobei ein `#` innerhalb einer Zeichenkette („#fuer-beringer") keinen
 * Kommentar eröffnet, weil Literale zuerst gelesen werden.
 */
function nurPythonZeichenketten(source) {
  const out = leeresGeruest(source);
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (char === '#') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (char === '"' || char === '\'') {
      const dreifach = source.startsWith(char.repeat(3), i);
      const begrenzer = dreifach ? char.repeat(3) : char;
      const ende = pythonStringEnd(source, i, begrenzer);
      if (!dreifach) {
        for (let k = i; k <= ende && k < source.length; k += 1) {
          if (source[k] !== '\n') out[k] = source[k];
        }
      }
      i = ende + 1;
      continue;
    }
    i += 1;
  }
  return out.join('');
}

/** Was eine Regel von einer Datei zu sehen bekommt, Zeile für Zeile. */
function zeilen(sicht, rel, source) {
  const html = rel.endsWith('.html');
  if (sicht === 'quelltext') {
    return maskiereKommentare(source, html).split('\n');
  }
  if (html) {
    // Vorlagentext ist selbst schon Oberfläche — nur die Kommentare fallen weg.
    return maskiereKommentare(source, true).split('\n');
  }
  if (rel.endsWith('.py')) {
    return nurPythonZeichenketten(source).split('\n');
  }
  return nurZeichenketten(maskiereKommentare(source, false)).split('\n');
}

const verletzungen = new Map(REGELN.map((regel) => [regel.id, []]));
const geprueft = new Map(REGELN.map((regel) => [regel.id, 0]));

for (const regel of REGELN) {
  for (const quelle of regel.quellen) {
    for (const wurzel of quelle.wurzeln) {
      for (const file of walk(wurzel, quelle.endungen)) {
        const rel = relative(quelle.basis, file).split('\\').join('/');
        if (quelle.istTest(rel)) continue;
        if (!regel.gilt(rel)) continue;

        geprueft.set(regel.id, geprueft.get(regel.id) + 1);
        const source = readFileSync(file, 'utf8');
        const roh = source.split('\n');
        const gesehen = zeilen(regel.sicht, rel, source);
        gesehen.forEach((line, index) => {
          if (regel.erlaubt(roh[index] ?? '')) return;
          if (regel.muster.some((muster) => muster.test(line))) {
            verletzungen.get(regel.id).push(regel.meldung(rel, index + 1));
          }
        });
      }
    }
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
