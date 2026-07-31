#!/usr/bin/env node
// `docs/adr/` bleibt nummernrein, und der Index sagt vorher, welche Nummer frei ist (#479).
//
// Zwei ADRs trugen einmal dieselbe Nummer 0016 — am selben Tag angelegt, neun
// Stunden auseinander, weil die zweite Autorin die erste nie gesehen hatte. Der
// Merge meldete nichts: es waren zwei *verschiedene* Dateinamen. Aufgeräumt hat
// das #416; verhindert hat es niemand. In einem Repo, dessen PRD-Läufe
// grundsätzlich in parallelen Worktrees stattfinden, ist das kein Unfall,
// sondern der Normalfall, der nur auf seinen nächsten Anlass wartet.
//
// Dieses Skript hält deshalb zwei Regeln, und es hält sie zusammen, weil die
// eine ohne die andere verrottet:
//
//   1. **Doppelnummern sind ein Fehler.** Zwei Dateien mit derselben `NNNN` —
//      gemeldet mit der Nummer *und beiden Dateinamen*, denn wer den Konflikt
//      auflösen soll, muss wissen, welche zwei Einträge kollidieren.
//   2. **Der Index ist erzeugt, nicht gepflegt.** `docs/adr/README.md` entsteht
//      aus dem Verzeichnis. Im Prüfmodus ist jede Abweichung zwischen Datei und
//      erzeugtem Inhalt ein Fehler; `--write` schreibt sie neu. Ein
//      handgepflegter Index wäre nur die nächste Fläche, auf der etwas veraltet
//      — genau wie die *Numbering note*, die früher am Ende von ADR 0019 stand
//      und den Kollisionsstand dieses Verzeichnisses aus dem Gedächtnis
//      wiedergab.
//
// Der eigentliche Zweck des Index steht in seiner letzten Zeile: die **nächste
// freie Nummer**. Die Doppelnummern-Prüfung meldet den Fehler, *nachdem* er
// passiert ist; die sichtbare freie Nummer verhindert ihn davor. Deshalb gehört
// beides in dasselbe Werkzeug.
//
// **Warum auf Repo-Ebene und nicht unter `frontend/scripts/`:** die vier
// bestehenden `check-*.mjs` prüfen Anwendungscode und laufen im CI-Job
// *Frontend build*, also hinter `npm ci`. Ein `docs/`-Anliegen darf nicht davon
// abhängen, dass ein Node-Modulbaum installierbar ist. Dieses Skript nutzt
// ausschließlich `node:fs`/`node:path`/`node:url`; sein CI-Job besteht aus
// Checkout, Node-Setup und diesem Aufruf.
//
// Aufruf:
//   node scripts/check-adr-index.mjs            # prüfen (Exit ≠ 0 bei Verletzung)
//   node scripts/check-adr-index.mjs --write    # Index neu erzeugen, Exit 0

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const ADR_DIR = join(REPO_ROOT, 'docs', 'adr');
const INDEX_DATEI = 'README.md';
const INDEX_PFAD = join(ADR_DIR, INDEX_DATEI);

/** Wie dieses Skript in seinen eigenen Meldungen heißt. */
const SKRIPT = 'scripts/check-adr-index.mjs';
const INDEX_REL = 'docs/adr/README.md';
const NEU_ERZEUGEN = `node ${SKRIPT} --write`;

/**
 * Der Dateinamensvertrag einer ADR: `NNNN-kebab-titel.md`, `NNNN` vierstellig
 * mit führenden Nullen.
 *
 * Genau vier Ziffern, dann ein Bindestrich — `00123-foo.md` fällt heraus, weil
 * auf die vierte Ziffer keine fünfte folgen darf. Was nicht passt, wird vom
 * Nummernscan **ignoriert** statt gemeldet; das ist keine Nachlässigkeit,
 * sondern notwendig: `README.md` ist selbst der erzeugte Index und darf die
 * Prüfung nicht auslösen, die ihn erzeugt hat.
 *
 * Der Slug hinter der Nummer wird bewusst nicht enger geprüft. Ob er zur
 * Überschrift passt, ist eine andere Frage als die Nummernreinheit — und eine
 * zu strenge Form würde eine echte ADR stillschweigend aus dem Index werfen,
 * also genau den blinden Fleck erzeugen, den dieses Skript schließen soll.
 */
const ADR_DATEINAME = /^(\d{4})-.+\.md$/;

/** Die erste `# `-Überschrift der Datei — YAML-Frontmatter darf vorangehen. */
const UEBERSCHRIFT = /^#\s+(.+?)\s*$/;

/**
 * Wie viele abweichende Zeilen einzeln benannt werden, bevor der Rest
 * zusammengefasst wird. Ein aus dem Ruder gelaufener Index soll die Ausgabe
 * nicht fluten; die ersten Zeilen sagen ohnehin schon, was zu tun ist.
 */
const MAX_ABWEICHUNGEN = 10;

/** Vierstellig mit führenden Nullen — die Schreibweise des Dateinamens. */
function alsNummer(zahl) {
  return String(zahl).padStart(4, '0');
}

/**
 * Alle ADR-Dateien des Verzeichnisses, aufsteigend nach Nummer, bei gleicher
 * Nummer nach Dateiname.
 *
 * Nichts hier ist fest verdrahtet: weder eine Liste, noch eine höchste Nummer,
 * noch eine „nächste freie". Alles kommt aus `readdirSync` — sonst wäre das
 * Skript beim nächsten ADR selbst die Datei, die veraltet.
 */
function leseAdrDateien() {
  return readdirSync(ADR_DIR, { withFileTypes: true })
    .filter((eintrag) => eintrag.isFile())
    .map((eintrag) => {
      const treffer = ADR_DATEINAME.exec(eintrag.name);
      return treffer ? { datei: eintrag.name, nummer: treffer[1] } : null;
    })
    .filter((adr) => adr !== null)
    .sort((a, b) => a.nummer.localeCompare(b.nummer) || a.datei.localeCompare(b.datei));
}

/**
 * Der Titel einer ADR: ihre erste `# `-Überschrift.
 *
 * Keine feste Zeilennummer — 40 der ADRs beginnen mit `---\nstatus: accepted\n---`
 * und tragen die Überschrift in Zeile 5, `0001` hat keinen Frontmatter und
 * beginnt direkt mit ihr. Fehlt sie ganz, ist das ein Fehler: ein Indexeintrag
 * ohne Titel wäre eine Zeile, die niemandem sagt, was in der Datei steht.
 */
function leseTitel(datei) {
  for (const zeile of readFileSync(join(ADR_DIR, datei), 'utf8').split('\n')) {
    const treffer = UEBERSCHRIFT.exec(zeile);
    if (treffer) return treffer[1];
  }
  return null;
}

/**
 * Der Index, wie er aussehen muss.
 *
 * Ein Eintrag trägt Nummer, Titel und den Link auf den Dateinamen — sonst
 * nichts: kein `status:`, kein Datum, keine Beziehungen. Verlinkt ist die
 * Nummer, nicht der Titel; eine Nummer enthält niemals eckige Klammern, ein
 * Titel könnte es, und ein Index, der an einem Sonderzeichen zerbricht, ist
 * schlimmer als einer, in dem man auf vier Ziffern klickt.
 *
 * Bei einer Kollision erscheinen **beide** Einträge. Der Index verschweigt
 * nichts, was die Prüfung meldet — er zeigt denselben Zustand, nur früher.
 *
 * Lücken in der Nummernfolge sind kein Fehler und werden nicht kommentiert.
 * Die letzte Zeile nennt die nächste freie Nummer: höchste vergebene + 1.
 */
function erzeugeIndex(adrs) {
  const hoechste = adrs.reduce((max, adr) => Math.max(max, Number(adr.nummer)), 0);
  const zeilen = [
    `<!-- Erzeugt von ${SKRIPT} (#479) — nicht von Hand bearbeiten. -->`,
    `<!-- Neu erzeugen: ${NEU_ERZEUGEN} -->`,
    '',
    '# Architecture Decision Records',
    '',
    'Alle Entscheidungen dieses Verzeichnisses, aufsteigend nach Nummer.',
    '',
  ];

  for (const adr of adrs) {
    zeilen.push(`- [${adr.nummer}](${adr.datei}) — ${adr.titel}`);
  }

  zeilen.push('', `**Nächste freie Nummer: ${alsNummer(hoechste + 1)}**`, '');
  return zeilen.join('\n');
}

/** Die Doppelnummern — Nummer samt aller Dateien, die sie tragen. */
function findeDoppelnummern(adrs) {
  const nachNummer = new Map();
  for (const adr of adrs) {
    if (!nachNummer.has(adr.nummer)) nachNummer.set(adr.nummer, []);
    nachNummer.get(adr.nummer).push(adr.datei);
  }
  return [...nachNummer.entries()].filter(([, dateien]) => dateien.length > 1);
}

/** Zeilenweise Abweichungen zwischen Datei und erzeugtem Inhalt. */
function findeAbweichungen(vorhanden, erwartet) {
  const ist = vorhanden.split('\n');
  const soll = erwartet.split('\n');
  const abweichungen = [];

  for (let i = 0; i < Math.max(ist.length, soll.length); i += 1) {
    if (ist[i] === soll[i]) continue;
    abweichungen.push({
      zeile: i + 1,
      erwartet: soll[i] === undefined ? '(Dateiende)' : soll[i],
      gefunden: ist[i] === undefined ? '(Dateiende)' : ist[i],
    });
  }
  return abweichungen;
}

const argumente = process.argv.slice(2);
const unbekannt = argumente.filter((argument) => argument !== '--write');
if (unbekannt.length > 0) {
  console.error(`Unbekanntes Argument: ${unbekannt.join(' ')}`);
  console.error(`Aufruf: node ${SKRIPT} [--write]`);
  process.exit(2);
}
const schreiben = argumente.includes('--write');

const adrs = leseAdrDateien();

// Ohne Titel lässt sich kein Index erzeugen — dieser Fehler bricht deshalb
// beide Modi ab, nicht nur den Prüfmodus.
const ohneTitel = [];
for (const adr of adrs) {
  adr.titel = leseTitel(adr.datei);
  if (adr.titel === null) ohneTitel.push(adr.datei);
}

if (ohneTitel.length > 0) {
  console.error('ADR-Nummern und -Index (#479):\n');
  for (const datei of ohneTitel) {
    console.error(
      `  docs/adr/${datei}: keine „# "-Überschrift gefunden — der Index braucht ` +
        `einen Titel, und ein leerer Eintrag wäre keiner. Trage eine ` +
        `\`# \`-Überschrift nach (Frontmatter darf vorangehen).`,
    );
  }
  console.error(`\n${ohneTitel.length} Verletzung(en).`);
  process.exit(1);
}

const erwarteterIndex = erzeugeIndex(adrs);

if (schreiben) {
  writeFileSync(INDEX_PFAD, erwarteterIndex, 'utf8');
  console.log(`${INDEX_REL} erzeugt: ${adrs.length} ADR(s).`);
  process.exit(0);
}

const verletzungen = [];
let indexBetroffen = false;

for (const [nummer, dateien] of findeDoppelnummern(adrs)) {
  verletzungen.push(
    `docs/adr/: Nummer ${nummer} ist doppelt vergeben — ${dateien
      .map((datei) => `\`${datei}\``)
      .join(' und ')}. Zwei ADRs mit derselben Nummer melden beim Merge keinen ` +
      `Konflikt; eine der beiden muss auf die nächste freie Nummer umziehen.`,
  );
}

if (!existsSync(INDEX_PFAD)) {
  indexBetroffen = true;
  verletzungen.push(
    `${INDEX_REL}: fehlt — der Index wird erzeugt, nicht von Hand gepflegt.`,
  );
} else {
  const abweichungen = findeAbweichungen(readFileSync(INDEX_PFAD, 'utf8'), erwarteterIndex);
  if (abweichungen.length > 0) {
    indexBetroffen = true;
    for (const abweichung of abweichungen.slice(0, MAX_ABWEICHUNGEN)) {
      verletzungen.push(
        `${INDEX_REL}:${abweichung.zeile}: erwartet „${abweichung.erwartet}", ` +
          `gefunden „${abweichung.gefunden}".`,
      );
    }
    if (abweichungen.length > MAX_ABWEICHUNGEN) {
      verletzungen.push(
        `${INDEX_REL}: … und ${abweichungen.length - MAX_ABWEICHUNGEN} weitere ` +
          `abweichende Zeile(n).`,
      );
    }
  }
}

if (verletzungen.length > 0) {
  console.error('ADR-Nummern und -Index (#479):\n');
  for (const verletzung of verletzungen) console.error(`  ${verletzung}`);
  if (indexBetroffen) {
    console.error(`\nIndex neu erzeugen: \`${NEU_ERZEUGEN}\``);
  }
  console.error(`\n${verletzungen.length} Verletzung(en).`);
  process.exit(1);
}

const hoechste = adrs.reduce((max, adr) => Math.max(max, Number(adr.nummer)), 0);
console.log(
  `docs/adr/ ist nummernrein und der Index ist aktuell: ${adrs.length} ADR(s) ` +
    `geprüft, nächste freie Nummer ${alsNummer(hoechste + 1)}.`,
);
