---
status: accepted
---

# Ein Tot-Fund trägt eigene Export-Codes (Umstand 08, Zustand 2)

## Context

Drei Dokumente sagten bisher übereinstimmend, dass ein Tot-Fund den Export nur als
Bemerkungstext erreicht:

- **CONTEXT.md, Umstand** — „A property of the Projekt."
- **ADR 0002** — Fangmethode/Lockmittel/Umstand sind konstante Projekt-Attribute;
  „per-entry override is left as a future extension."
- **ADR 0026** — ein Tot-Fund bekommt keine Zeilenfarbe und „reaches the export only
  as the 'Tot-Fund' text already in the Bemerkung column."

Aus dem Beta-Feedback: ein Tot-Fund muss in der Datenmeldung als **Umstand 08** statt
des Projektwerts (25) und mit **Zustand 2** gemeldet werden. Die Meldestelle liest den
Bemerkungstext nicht als Codewert — die Spalten müssen stimmen.

Beim Nachsehen fiel ein zweites Loch auf: die 515 Beispielzeilen der echten
`Datenmeldung_Vorlage_IWM.xlsx` tragen **ausnahmslos** `Zustand = 8`. BirdDoc
exportierte die Spalte auf **jeder** Zeile leer.

## Decision

**Die Codes werden beim Export abgeleitet, nicht gespeichert.** Es gibt kein neues
Feld am Fang und der Beringer wählt nie einen Code — der Fangmarker *impliziert* ihn:

- `is_dead_recovery` ⇒ **Umstand 08**, **Zustand 2**
- sonst ⇒ **Umstand** = Projektwert, **Zustand 8** (lebend, unverletzt freigelassen)

**Zustand wird auf jeder Zeile befüllt**, nicht nur beim Tot-Fund.

**Die Blanking-Regel aus ADR 0026 wird über die *Quelle* des Wertes formuliert**, nicht
über eine feste Spaltenliste: ein Nicht-Standard-Fang leert die Methodenspalten, **die
das Projekt liefert**. Fangmethode und Lockmittel sind immer die des Projekts, also
immer leer; Umstand ebenso — **außer** der Fang ist zugleich Tot-Fund, dann überlebt
die 08. Das löst die Kollision, die ADR 0026 offenließ, obwohl es beide Marker
gleichzeitig ausdrücklich erlaubt.

**Der Import liest die Codes zurück.** Eine Zeile mit **Umstand 08 allein** wird als
Tot-Fund rekonstruiert (Zustand ist bestätigend, nie erforderlich), und solche Zeilen
zählen nicht in die Homogenitätsprüfung der Projekt-Umstandsspalte. Fehlt die
Bemerkung, wird sie als schlichtes „Totfund" gesetzt.

## Considered options

- **ADR 0002s per-Fang-Override richtig bauen** — ein nullbares `circumstance` (+
  Zustand) am Fang, vorbelegt vom Projekt, vom Marker auf 08/2 gesetzt, aber
  überschreibbar. EURING-treu, aber zwei Codefelder mehr in einem Formular, das
  bewusst schlank gehalten wird, plus Offline-Payload und Import. Verworfen: der
  Bedarf ist heute vollständig vom Marker ableitbar.
- **Zustand nur beim Tot-Fund befüllen, sonst leer lassen** — ehrlicher (wir kennen
  den Zustand nicht), aber keine echte Datenmeldung hat dort eine leere Spalte.
  Verworfen zugunsten der Formattreue; siehe Consequences.
- **Nicht-Standard gewinnt die Kollision (Umstand bleibt leer)** — verworfen: es wirft
  die einzige Umstandsinformation weg, die wir für diesen Fang sicher haben.
- **Beide Marker gegenseitig ausschließen** — verworfen: widerspricht ADR 0026 und
  bräuchte eine Migration für bestehende doppelt markierte Fänge.
- **Beim Import 08 **und** 2 verlangen** — verworfen: eine fremde Datei mit 08 und
  abweichendem Zustand verlöre ihren Marker stillschweigend.
- **Eine Zeile mit 08 und leerer Bemerkung blockieren** — verworfen: `validate_capture`
  macht die Bemerkung bei jedem Fangmarker zur Pflicht, das würde bisher importierbare
  historische Dateien rot färben.

## Consequences

- **Jede exportierte Zeile behauptet jetzt `Zustand 8`** — „lebend, unverletzt
  freigelassen" — auch für Vögel, deren Zustand die App gar nicht erfasst. Ein lebend,
  aber verletzt freigelassener Vogel wird als 8 gemeldet. Das ist eine bewusst
  eingegangene Ungenauigkeit; sie sauber aufzulösen hieße, Zustand als echtes
  Fangfeld zu modellieren.
- Umstand ist ab jetzt **nicht mehr durchgängig** der Projektwert. Wer zwei Exporte
  desselben Projekts vergleicht, sieht abweichende Zeilen — genau die Tot-Funde.
- Export und Import sind jetzt über die Codes gekoppelt: 08 zu ändern heißt, beide
  Seiten zugleich zu ändern.
- Ein Tot-Fund überlebt jetzt den Round-Trip als Marker, nicht mehr nur als Prosa.
  Das war bislang eine stille Lücke von ADR 0013.
