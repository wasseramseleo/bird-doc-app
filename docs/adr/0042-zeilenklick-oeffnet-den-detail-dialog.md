---
status: accepted
---

# Der Zeilenklick öffnet den Detail-Dialog, der Dialog führt zum Bearbeiten

## Context

Dies ist die **zweite Fassung** dieser Entscheidung. Die erste hieß „Das
Detail-Zeichen führt zum Detail-Dialog, der Zeilenklick führt zum Bearbeiten"
(#478) und ist hier an Ort und Stelle abgelöst — Dateiname und Überschrift
eingeschlossen, weil der erzeugte ADR-Index ausschließlich Nummer und
Überschrift liest und sonst weiter mit der alten Regel würbe.

**Der Befund der ersten Fassung gilt unverändert** und ist der Grund, dass es
diese ADR überhaupt gibt: in den Fang-Tabellen führte dieselbe Geste je nach
Tabelle woandershin, und niemand konnte sagen, welche der beiden recht hatte —
weil die Regel nirgends stand.

- **#405** gab der Wiederfang-Historie einen Zeilenklick auf den Detail-Dialog
  statt auf die Bearbeitungsmaske und begründete das in einem
  Template-Kommentar: der Beringer steht mitten in einer Erfassung und würde
  den laufenden Fang verlieren.
- **#468** änderte drei Wochen später die Bedeutung des ⓘ. Es heißt seither
  nicht mehr „hat Bemerkung", sondern **„in dieser Zeile steht mehr, als die
  Spalten zeigen — antippen"**, und erscheint deshalb auch bei **Brutfleck**
  oder **CPL+**, die in keiner Tabelle eine Spalte haben. Mit dem Wortlaut kam
  ein Akzeptanzkriterium: „Ein Tippen auf die Zeile führt weiterhin zum
  Detail-Dialog." Für „Letzte Fänge" traf das nie zu — dort navigierte der
  Zeilenklick in die Bearbeitungsmaske. Das Kriterium ging trotzdem durch den
  Review.
- **#478** fand die Folge: in einem Projekt, das den Brutfleck über die
  **Optionalen Felder** abgeschaltet hat (ADR 0035), warb das ⓘ in „Letzte
  Fänge" mit „Brutfleck" — und der Bildschirm, auf dem das Antippen landete,
  blendete genau dieses Kästchen aus. Ein Kommentar auf der Ausnahme konnte die
  Regel nicht verteidigen, weil die Regel nicht geschrieben war.

**Was die erste Fassung nicht sah** und woran sie gescheitert ist: sie hat die
Frage „welche Geste führt wohin?" beantwortet, ohne zu prüfen, ob es für einen
gewöhnlichen Fang überhaupt einen Leseweg gibt. Den gibt es nicht. Der
Detail-Dialog ist die einzige Oberfläche, die *jedes* Merkmal eines Fangs zeigt,
erreichbar war er allein über das Detail-Zeichen — und das erscheint nur bei
**Brutfleck**, **CPL+** oder einer **Bemerkung**. Ein Fang ohne diese drei, also
die Mehrzahl aller Fänge, war schlicht nicht ansehbar: der Zeilenklick führte in
die Bearbeitungsmaske, einen Bildschirm zum Ändern, mit einem Speichern-Knopf,
den niemand drücken wollte, und einer Rückfrage beim Verlassen.

Die erste Fassung hat damit die **Ausnahme** repariert und die **Regel** stehen
lassen. Die Grilling-Sitzung zur Triage von #480 hat das aufgedeckt (PRD #491):
nicht die Marker-Spalte fehlte, sondern der Leseweg.

## Decision

> Der **Zeilenklick öffnet den Detail-Dialog** — in **jeder** Fang-Tabelle,
> online wie offline, ohne Ausnahme und ohne Fallunterscheidung. Eine Zeile
> antippen heißt „zeig mir diesen Fang".
>
> Der **Detail-Dialog trägt „Bearbeiten"** und ist damit der Weg zum Schreiben.
> Schreibgeschützt bleibt er trotzdem: der Knopf führt **hinaus**, er ändert
> nichts an Ort und Stelle.
>
> Das **Detail-Zeichen (ⓘ) ist passiv**. Es *benennt* das Bemerkenswerte, es
> öffnet nichts; sein Klick steigt zur Zeile auf wie der von ♥ und ⚑.

Die Regel liegt genau einmal im Code: ein geteilter **Öffner** in `shared/` ist
die eine Einheit, die weiß, was das Öffnen eines Fangs bedeutet — die
Dialog-Konfiguration, die Umwandlung in das Lesemodell, ob „Bearbeiten"
angeboten oder gesperrt ist und mit welchem Grund, und wohin es führt, samt
Wächter-Umweg. Die drei Tabellen rufen nur „öffne diesen Fang". Eine Tabelle
kann die Regel dadurch nicht falsch verdrahten — und genau das war in #478
passiert.

Weil der Zeilenklick jetzt der Leseweg *jedes* Fangs ist, sind die **Zeilen aller
drei Fang-Tabellen tastaturbedienbar** (Tabulator-Halt, Rolle, Enter/Leertaste).
Das ist keine Kür: der einzige Tastaturweg in den Dialog war bis hierher das ⓘ,
und das erscheint bei einem gewöhnlichen Fang gar nicht.

## Considered options

### Warum zwei Verwerfungen der ersten Fassung diese Kombination nicht überleben

Die erste Fassung verwarf beide Hälften der heutigen Regel — **einzeln**. Zusammen
beantworten sie einander, und ohne diesen Absatz verwirft der nächste Durchlauf
dieselbe Kombination erneut aus derselben Begründung.

- **„Letzte Fänge" öffnet den Detail-Dialog auch beim Zeilenklick.** Verworfen
  mit: *„Letzte Fänge" ist der Weg zur Korrektur eines eben erfassten Fangs; ein
  Dialog dazwischen macht aus einem Klick drei.* — **Die Drei war die Rechnung
  ohne den Knopf.** Sie zählte Zeile, Dialog schließen, Zeile noch einmal: den
  Umweg über eine Sackgasse. Mit „Bearbeiten" im Dialog sind es **zwei** —
  Zeile, Bearbeiten —, und der Schritt dazwischen ist kein Aufenthalt, sondern
  genau der Bildschirm, den die Beringer:in in der Mehrzahl der Fälle ohnehin
  wollte. Ein Dialog, der den Weg weiterträgt, liegt nicht *dazwischen*.
- **Der Detail-Dialog bekommt einen „Bearbeiten"-Knopf.** Verworfen mit: *er ist
  schreibgeschützt und soll es bleiben; der Zeilenklick in „Letzte Fänge" ist der
  direkte Weg und braucht keinen Umweg daneben.* — Diese Verwerfung setzte
  **schreibgeschützt** mit **ausgangslos** gleich. Der Dialog bleibt
  schreibgeschützt: er ändert nichts an Ort und Stelle, der Knopf führt hinaus.
  Und der zweite Halbsatz stützte sich auf den direkten Zeilenklick — der mit der
  ersten Hälfte dieser Entscheidung wegfällt. Die beiden Verwerfungen trugen sich
  gegenseitig; fällt eine, fällt die andere mit.

**Was das kostet, offen benannt:** die Korrektur eines eben erfassten Fangs in
„Letzte Fänge" kostet einen Klick mehr — von einem auf zwei. Der Einwand der
ersten Fassung halbiert sich, er verschwindet nicht. Dagegen steht, dass der
Leseweg für die Mehrzahl aller Fänge heute nicht zwei Klicks kostet, sondern
**nicht existiert**.

### Warum das Detail-Zeichen seinen Knopf wieder verliert

#478 machte das ⓘ zu einem echten Knopf (`aria-haspopup="dialog"`, den Klick
schluckend), und der Grund war gut: ein natives `title` hat **keinerlei**
Touch-Verhalten. Auf dem Tablet — dem Fall, für den das „antippen" überhaupt
gedacht war — trug das Zeichen also gar keine Information, der Tap war der
**einzige** Weg dorthin, und er führte woandershin.

**Diese Prämisse fällt mit der ersten Hälfte dieser Entscheidung weg.** Führt der
Tipp über die Zeile ohnehin zum Detail-Dialog, muss das Zeichen den Weg nicht
selbst tragen. Es behält, was nichts anderes trägt: der Beringer:in **vor** dem
Antippen sagen, was in dieser Zeile mehr steht als die Spalten zeigen, damit sie
beim Abscannen einer Liste entscheiden kann, welche Zeile sie überhaupt öffnet.

Ohne diesen Absatz liest der nächste Durchlauf die Begründung von #478 und baut
den Knopf wieder ein. Wer ihn wieder einbaut, öffnet den Dialog **doppelt**: das
Zeichen trüge sein eigenes Ziel *und* sein Klick stiege zur Zeile auf.

### Weiter verworfen — unverändert gültig

- **Das ⓘ bekommt eine andere Aufforderung** und der Zeilenklick in „Letzte
  Fänge" bleibt der einzige Weg. Verworfen in #478: „mehr erfahren" ohne Weg zum
  Mehr ist keine Aufforderung, sondern eine Notiz. Diese Fassung erledigt den
  Einwand anders herum — sie gibt jedem Fang den Weg, statt dem Zeichen das
  Versprechen zu nehmen.
- **Das ⓘ kennt die Optionale-Felder-Konfiguration** und verschweigt einen
  abgeschalteten Brutfleck. Verworfen in #468 und hier erneut: der Brutfleck
  wurde am Vogel erhoben, nicht am Formular (dieselbe Linie wie ADR 0035). Der
  Detail-Dialog ist das Einzige, was *jedes* Merkmal zeigt — deshalb ist er das
  richtige Ziel und nicht das Zeichen das falsche.
- **Die Regel nur als Template-Kommentar.** Verworfen: das war die Lage vor
  #478, und sie hat genau einmal funktioniert — bis das nächste Ticket eine
  Annahme darüberlegte. Genau deshalb wird diese ADR umgeschrieben statt
  ergänzt: eine geschriebene Regel, die dem Code widerspricht, ist gefährlicher
  als gar keine.

## Consequences

- **Die Wiederfang-Historie ist keine Ausnahme mehr.** Was dort die benannte
  Abweichung war, ist jetzt die Regel; für die Beringer:in mitten in einer
  Erfassung verschlechtert sich nichts. Die Begründung aus #405 — Navigation
  würde den laufenden Fang zerstören — trägt jetzt jede Tabelle, und wo sie doch
  greifen muss, greift der `unsavedChangesGuard` am „Bearbeiten"-Knopf.
- **Zwei Wege zum Dialog gibt es nirgends mehr.** Dass in der Historie Zeile und
  Detail-Zeichen zusammenfielen, war in der ersten Fassung eine eigens erklärte
  Vorhersage der Regel; mit dem passiven ⓘ erübrigt sich die Erklärung: es trägt
  keinen Weg mehr, es sitzt in der Zeile, und sein Klick steigt auf. Ein Tipp,
  eine Wirkung.
- **„Heute" fragt die Verbindung nicht mehr.** Die Fallunterscheidung „online
  navigieren / offline Dialog" fällt ersatzlos weg; beide Abschnitte öffnen
  denselben Dialog. Die Regel dahinter geht nicht verloren, sie wandert (siehe
  den gesperrten Knopf unten).
- **Der gesperrte „Bearbeiten"-Knopf trägt jetzt den Offline-Schreibschutz.** Ein
  synchronisierter Fang ist offline nicht bearbeitbar (append-only, PRD #152).
  Der Fall ist eng — **nur** synchronisiert **und** offline —; der Knopf bleibt
  dabei **sichtbar**, ist nicht auslösbar und **nennt den Grund** (dieselbe Linie
  wie ADR 0037: nie ein verwehrter Weg ohne den Satz, der sagt warum und wann
  wieder). Umgesetzt mit **`aria-disabled` und einer über `aria-describedby`
  erreichbaren Begründung**, ausdrücklich **nicht** mit einem blanken
  `disabled` — das überspränge ein Screenreader und nähme der Beringer:in beides
  (Lehre aus #416/#417). Weil der Knopf anfassbar bleibt, kommt sein Klick
  weiterhin an und muss im Code enden; das ist kein Versehen, sondern der Preis
  der Erreichbarkeit. Die Sperre hängt an einem Signal, also an der **Reichweite
  des Geräts** und nicht am Alter des Fangs: kommt die Verbindung wieder, ist der
  Knopf im offenen Dialog sofort wieder auslösbar. Der Offline-Schreibschutz
  bleibt dabei, was #386 aus ihm gemacht hat — eine bewusste Affordance dieser
  Oberfläche, **keine app-weit durchgesetzte Invariante**.
- **Ein nicht synchronisierter Fang öffnet denselben Dialog** — über einen
  **eigenen Eingang des Öffners**, weil er kein Server-Datensatz ist: er trägt
  flache Ids und wird best effort gegen das zwischengespeicherte Offline-Bundle
  aufgelöst. Dafür gibt es ein **Lesemodell** mit nullbaren Referenzen, erzeugt
  von zwei reinen Funktionen (eine aus einem Fang-Datensatz, eine aus einem
  Warteschlangen-Eintrag plus Bundle). `DataEntry` bleibt unangetastet — seine
  Referenzen nullbar zu machen, um einen Bildschirm zu bedienen, der kein
  Server-Datensatz ist, hätte jeden Leser eines Fangs zu Null-Behandlung
  gezwungen. Sein „Bearbeiten" ist **nicht** gesperrt und führt auf die
  bestehende Warteschlangen-Bearbeitung: offline bearbeitbar zu sein ist der Sinn
  der Warteschlange.
- **Eine nicht auflösbare Referenz heißt „auf diesem Gerät nicht bekannt"** — und
  nicht Gedankenstrich. Art, Station und Beringer:in sind Pflichtangaben; der
  Strich, der daneben „nicht gemessen" heißt, läse sich bei ihnen als „nicht
  erfasst" und ließe die Beringer:in an ihrer eigenen Erfassung zweifeln. Die
  Zeile in „Heute" sagt dasselbe wie der Dialog, den sie öffnet — sonst
  widerspräche der Bildschirm sich selbst.
- **„Im Backend öffnen" ist ersatzlos weg.** Django ist ein Werkzeug für Admins;
  die Navigationsleiste zeigt den Zugang bewusst nur hinter dem Staff-Recht, im
  Dialog endete er für alle anderen an einer Rechtewand. Der Zugang selbst bleibt,
  wo er hingehört.
- **Die geteilte Marker-Komponente ist wieder rein präsentational.** Die
  Feststellung der ersten Fassung („damit nicht mehr rein präsentational") ist
  hiermit **zurückgenommen**: alle drei Slots tragen Information, keiner trägt
  eine Handlung, und die Komponente kennt den Dialog-Öffner nicht.
- **Die Zeilen sind tastaturbedienbar** — an einer Stelle für alle drei Tabellen.
  Die Rolle ist eine bewusste Abwägung: auf den beiden Material-Tabellen
  überschreibt sie das `role="row"` der Zeile. Was verloren geht, ist die
  Zeilen-Navigation des Screenreaders; was gewonnen wird, ist der einzige Leseweg
  eines gewöhnlichen Fangs. Ein Tastendruck, der einem Knopf *in* der Zeile galt
  (Löschen in „Heute"), gehört nicht der Zeile.
- **Ob ein Klick zur Zeile aufsteigt, ist eine Eigenschaft der Komposition und
  auf der geteilten Komponente nicht beweisbar.** Diese Feststellung der ersten
  Fassung gilt unverändert und ist die Lehre, an der #478 überhaupt entstanden
  ist: dort blieb die Verdrahtung ungetestet, während die Komponente gut
  abgedeckt war. Deshalb liegt in **jeder** der drei Fang-Tabellen ein eigener
  Pin — der Zeilenklick öffnet **genau einmal**, ein Klick auf das ⓘ öffnet nicht
  zweimal und navigiert nicht, die Zeile öffnet mit Enter und Leertaste, und der
  Lösch-Knopf in „Heute" öffnet **keinen** Dialog. Diese Pins sind **nicht**
  zusammenlegbar.
- **„Heute" trägt noch kein Detail-Zeichen** (und auch kein ♥ und ⚑) — die
  Marker-Konvention ist dort nie angekommen. Diese ADR beschreibt den Leseweg für
  alle drei Fang-Tabellen, behauptet aber nicht, die Marker-Konvention gelte
  überall; „Heute" nachzuziehen ist
  [#480](https://github.com/wasseramseleo/bird-doc-app/issues/480).
- **Die Verwaltungslisten** (Stationen, Beringer:innen, Projekte) bleiben
  unangetastet: ihre Zeilen tragen bereits benannte Knöpfe je Zeile und haben
  keinen Detail-Dialog. Die Mehrdeutigkeit, die diese Regel auflöst, gibt es dort
  nicht.
