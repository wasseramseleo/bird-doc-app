---
status: accepted
---

# Die gezeichnete Marke und ihre Ableitungen — ein Kanon je Artefakt, zwei Wurzeln, ein Skript

## Context

Die bisherige Marke ist ein **KI-generierter Platzhalter** (Canva), was
`docs/artist-brief.md` §1 selbst so benennt. Ersetzt wird sie durch von Hand
gezeichnete Originale. Der Zustand, den sie hinterlässt, ist unordentlicher als
ein reiner Bildtausch:

- **Die beiden Wurzeln zeigen zwei verschiedene Marken.** Die Angular-App führt
  `frontend/public/birddoc-logo-1930x1930.png` (502 KB) in Navileiste, Login und
  Projektwähler; die Landing führt `backend/landing/static/landing/birddoc-logo.png`
  (28 px) in der Wortmarke. Es sind **verschiedene Dateien**. ADR 0009 hat die
  Markenebene als quellzeitliche Kopie mit brechendem Paritätstest eingeführt —
  aber nur für `brand-tokens.css`. Die Bilder liefen nie unter dieser Disziplin,
  und genau dort ist die Drift dann auch eingetreten, ohne dass es jemand
  bemerkt hat.
- **`favicon.svg` ist 669 KB und enthält keinen einzigen `<path>`** — ein
  base64-eingebettetes PNG in einer SVG-Hülle. Das ist wörtlich das, was §3 des
  Briefings ausschließt („keine eingebetteten Pixelbilder").
- **Die PWA-Icons sind als `purpose:"maskable"` deklariert, sind es aber nicht.**
  `web-app-manifest-192/512.png` sind transparente Vögel ohne Vollflächengrund
  und ohne Safe-Zone; Android beschneidet maskable Icons kreisförmig, also
  fallen Beine und Schnabel weg — auf keinen Grund. Ein `purpose:"any"`-Icon
  fehlt ganz. `apple-touch-icon.png` trägt ebenfalls Alpha.
- **Die Lieferung ist unvollständig.** Geliefert sind A1 (in vier Varianten,
  gewählt: `fluffyfat`) und B3 — letzteres als Icon, nicht als die briefierte
  Spot-Illustration. **A2** (vereinfachtes Glyph für 16–32 px), **A3**
  (App-Icon-Kachel), **B1** (Empty-State) und **B2** (Erfolg) fehlen. Ungefragt
  dazugekommen sind ein **404-Vogel** und eine **Musterfläche** — beide in der
  Gestaltung inzwischen tragend.

Gemessen, nicht geschätzt: `fluffyfat` ist bei 16/24/28/32/48 px in **jeder**
Größe kontrastreicher und lesbarer als der Platzhalter. Die Tusche des
Artboards ist 1397×1683 in einer 2135×2134-Fläche — **rund 35 % mehr lineare
Tusche** bei gleicher Pixelgröße, wenn eng beschnitten wird. Die Musterfläche
kachelt in beiden Achsen **nahtlos** (2×2 geprüft); ihre 96 Pfade tragen nur 15
verschiedene Formsignaturen, die Unregelmäßigkeit liegt also in der Anordnung,
nicht in 32 Einzelzeichnungen — Zuschneiden auf eine kleinere Einheit würde sie
einebnen.

## Decision

**Ein Kanon je Artefakt, byte-gleich in beiden Wurzeln, unter demselben
brechenden Test wie die Tokens.** ADR 0009s Disziplin wird von der CSS-Ebene auf
die Marke ausgedehnt: `test_brand_parity.py` bewacht künftig auch die beiden
SVG-Kanons, die Musterfläche und die drei doppelt geführten Icon-Dateien
(`favicon.ico`, `favicon-96x96.png`, `apple-touch-icon.png`). Geprüft wird, dass
die **Wurzeln übereinstimmen** — nicht, dass eine Neuerzeugung bytegleich
ausfällt; ImageMagick-Versionen driften, und ein solcher Test wäre flatterig.

**Die Rasterableitungen erzeugt ein eingechecktes Skript**
(`scripts/build-brand-assets.sh`), die Ergebnisse werden eingecheckt. Aus zwei
SVG-Kanons entstehen elf Dateien. Eine PNG von Hand zu bearbeiten ist damit ein
Fehler, kein Handgriff.

**Zwei Zeichnungen der Marke, nicht eine.** `birddoc-marke.svg` trägt das volle
Artboard; `birddoc-glyph.svg` ist derselbe Vogel, mechanisch eng beschnitten,
und bedient jeden Platz ≤ 32 px (Favicon 16/32, Wortmarke 28 px, Navileiste).
A2 wird **nicht** beim Künstler nachbestellt, bevor dies steht: die Marke ist
heute schon in jeder ausgelieferten Größe besser als das, was live ist, und der
Beschnitt ist mechanisch und rückholbar. Bei 16 px bleibt sie matschig; das ist
bewusst in Kauf genommen.

**Die Kachel wird gerechnet, nicht gezeichnet.** A3 entsteht aus dem
beschnittenen Glyph, zentriert im **80-%-Safe-Kreis** auf vollflächigem
`#F7F2E8` — genau die Vorgabe aus §2/A3 des Briefings, als Zeile im Skript. Das
Manifest bekommt dabei **zusätzlich ein `purpose:"any"`-Paar**, und
`apple-touch-icon.png` einen deckenden Papiergrund. Der Manifest-Fehler wird
hier mitrepariert und nicht ausgelagert: ein korrektes Icon-Set in einen Slot zu
legen, von dem wir wissen, dass er falsch etikettiert ist, wäre das Festschreiben
des Fehlers.

**Die Musterfläche ist ein weißer Kanon, der über `mask-image` eingefärbt wird.**
Die Datei bleibt wie geliefert (weiße Vögel, transparenter Grund); wo sie auf
Papier läuft, malt `background-color` sie in Tusche, wo sie auf Tusche läuft, in
Papier. Deckkraft und Kachelgröße stehen als `--bd-muster-deckkraft` und
`--bd-muster-kachel` in `brand-tokens.css` — also unter derselben Parität wie
die Palette, damit „niedriger Kontrast" **ein** prüfbarer Wert ist und nicht
eine in `landing.css` und `login.scss` wiederholte Zahl, die beim ersten
Nachjustieren auseinanderläuft. Ihre Plätze: das eine Tinte-Band der
Marketing-Startseite, die beiden neuen Fehlerseiten (ADR 0044) und der
SPA-Login — überall als **Textur, nie als Illustration**.

**Die Musterfläche zeichnet `fluffy`, nicht `fluffyfat`.** Das ist bekannt und
angenommen. Es ist zugleich der Grund für die Textur-Regel: groß und scharf
gesetzt säße ein nicht-kanonischer Vogel in derselben Ansicht wie die Marke, in
einer Größe, in der Bauch und Stand unterscheidbar sind.

**Die Dateinamen sprechen die Sprache des Briefings.** `birddoc-marke.svg`
(A1 Master-Marke), `birddoc-glyph.svg` (A2 Vereinfachtes Glyph),
`birddoc-kachel-{192,512}.png` (A3 App-Icon-Kachel), `birddoc-muster.svg`. Die
Namen sind damit auf das Vertragsdokument zurückführbar, und wenn A2 später
eintrifft, fällt es in einen Slot, der bereits `glyph` heißt.

**Die Originale liegen im Repo, der Lieferordner nicht.** Alle sieben SVGs und
PNGs — die drei nicht gewählten Varianten eingeschlossen — wandern nach
`docs/brand/`, `__MACOSX`/`.DS_Store` entfernt (~950 KB). §6 des Briefings macht
die Quelldateien zum Leistungsbestandteil; ein Ordner, der nur zufällig auf
einer Platte liegt, ist keine Verwahrung. `birb/` wird nie eingecheckt.

**Nicht Teil dieser Entscheidung, aber hier mitentsorgt:** `logo-new.png` und
`dashboard-full.png` liegen versioniert im Wurzelverzeichnis und werden von
nichts referenziert (593 KB).

## Considered options

- **Bilder ohne Paritätswächter lassen.** Ein um wenige Bytes driftendes Favicon
  ist harmlos, anders als ein driftendes Farbtoken, und der Wächter macht jede
  künftige Asset-Änderung zu einer roten Testzeile. Verworfen: die Landing hinkt
  der App **heute** um eine ganze Logo-Generation hinterher, und niemandem ist es
  aufgefallen. Genau davor sollte ADR 0009 schützen.
- **A2 und A3 beim Künstler nachbestellen und bis dahin nichts ausliefern.**
  Vertragstreu. Verworfen: es blockiert eine Verbesserung, die in jeder heute
  ausgelieferten Größe messbar ist, auf einen fremden Terminplan. A2 bleibt eine
  eigene, nicht blockierende Nachbestellung.
- **Ein vereinfachtes Glyph selbst zeichnen** (Strich verstärken, Bauchlinie und
  Beine weglassen). Verworfen: das hieße, die eben bezahlte Marke selbst
  nachzuziehen, und schafft eine zweite Zeichnung, die synchron gehalten werden
  muss.
- **Genau eine Datei überall, Artboard-Rand inklusive.** Am einfachsten zu
  verwalten. Verworfen: 35 % lineare Tusche sind bei 24–32 px sichtbar, und der
  Beschnitt kostet nichts.
- **Zwei eingefärbte Kopien der Musterfläche statt einer Maske.** Kein
  `mask-image`-Support nötig. Verworfen: vier Dateien über zwei Wurzeln, die
  Farbe eingebrannt statt aus den Tokens, und der dritte Grund braucht die
  fünfte Datei. Der Ausfallmodus der Maske ist zudem der richtige: fehlt die
  Unterstützung, malt die Textur nicht, und die Seite sieht aus wie heute.
- **Muster inline als `<svg fill="currentColor">`.** Volle Kontrolle. Verworfen:
  76 KB in eine Login-Komponente und zwei Django-Vorlagen kopiert, und für die
  Wiederholung braucht es trotzdem CSS.
- **Die Musterfläche auf eine kleinere Wiederholungseinheit zuschneiden**
  (~5 KB statt 76 KB). Verworfen: die Unregelmäßigkeit liegt in der Anordnung
  der 32 Positionen; ein kleinerer Ausschnitt macht daraus ein Raster.
- **Minimal-Umbenennung** (`birddoc-logo.svg`), damit zwei bestehende
  Zusicherungen grün bleiben, die auf die Teilzeichenkette `birddoc-logo` prüfen.
  Verworfen: die Musterfläche hat keinen Altnamen und heißt so oder so deutsch;
  die Wahl steht real zwischen „durchgehend deutsch" und „deutsch für das Neue,
  englisch für das Alte".
- **Den Manifest-Fehler als eigenes Ticket führen.** Sauber zu bisektieren.
  Verworfen: siehe oben — das Set wäre dann korrekt und der Slot weiterhin
  falsch etikettiert.

## Consequences

- **Sieben Stellen ziehen den Namen nach**, drei davon Tests: `nav-bar.html:4`,
  `login.html:4`, `project-picker.html:43`, `project-picker.spec.ts:259`,
  `landing/base.html:37`, `test_hero.py:216`, `test_brand_layer.py:53+62`. Zwei
  heute grüne Zusicherungen werden dabei rot, ohne dass sich fachlich etwas
  ändert — sie prüfen die Marke und gehören ohnehin neu gelesen.
- **`favicon.svg` schrumpft um den Faktor 165** (669 KB → ~4 KB), und die
  Navileiste lädt statt 502 KB PNG ein 4-KB-SVG.
- **Ein `purpose:"any"`-Paar im Manifest ändert das Installationsverhalten** der
  PWA. Das ist eine Korrektur, aber eine sichtbare.
- **`ngsw-config.json` bleibt unangetastet**: die `assets`-Gruppe globt bereits
  `/*.(svg|png|…)`, jede neue Datei ist also abgedeckt.
- **`brand-tokens.css` trägt ab jetzt zwei Knöpfe, die keine Palette sind**
  (`--bd-muster-*`). Das weitet aus, was „Markenebene" heißt; die Alternative
  wäre dieselbe Zahl doppelt geführt gewesen.
- **Wer eine Ableitung ändern will, ändert den Kanon und lässt das Skript
  laufen.** Ein handgetippter PNG-Export ist ab jetzt ein Fehler mit einem
  Fundort.
- **A2, B1 und B2 fehlen weiterhin** und sind je als Nachbestellung verfolgt;
  keine Entscheidung dieses ADR wartet darauf. **Die nativen Quelldateien
  (AI/Affinity) sind nach §3 und §6 geschuldet und nicht geliefert** — separat
  verfolgt, weil es eine Vertragssache ist und keine Kunstbestellung. Ohne sie
  ist das in §6 zugesicherte Bearbeitungsrecht nur über das SVG ausübbar.
