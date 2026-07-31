---
status: accepted
---

# Das Detail-Zeichen führt zum Detail-Dialog, der Zeilenklick führt zum Bearbeiten

## Context

In den Fang-Tabellen führte dieselbe Geste je nach Tabelle woandershin, und
niemand konnte sagen, welche der beiden recht hatte — weil die Regel nirgends
stand.

Der Verlauf ist der eigentliche Befund:

- **#405** gab der Wiederfang-Historie einen Zeilenklick auf den Detail-Dialog
  statt auf die Bearbeitungsmaske und begründete das in einem
  Template-Kommentar: der Beringer steht mitten in einer Erfassung und würde
  den laufenden Fang verlieren.
- **#468** änderte drei Wochen später die Bedeutung des ⓘ. Es heißt seither
  nicht mehr „hat Bemerkung", sondern **„in dieser Zeile steht mehr, als die
  Spalten zeigen — antippen"**, und erscheint deshalb auch bei **Brutfleck**
  oder **CPL+**, die in keiner Tabelle eine Spalte haben. Mit dem Wortlaut kam
  ein Akzeptanzkriterium: „Ein Tippen auf die Zeile führt weiterhin zum
  Detail-Dialog." Für „Letzte Fänge" traf das nie zu — dort navigiert der
  Zeilenklick in die Bearbeitungsmaske. Das Kriterium ging trotzdem durch den
  Review.
- **#478** fand die Folge: in einem Projekt, das den Brutfleck über die
  **Optionalen Felder** abgeschaltet hat (ADR 0035), wirbt das ⓘ in „Letzte
  Fänge" mit „Brutfleck" — und der Bildschirm, auf dem das Antippen landet,
  blendet genau dieses Kästchen aus. Der gespeicherte Wert bleibt unangetastet
  und der Tooltip trägt die Information, es geht also nichts verloren; das
  Versprechen „antippen und mehr erfahren" wird aber nicht eingelöst.

Ein Kommentar auf der Ausnahme konnte die Regel nicht verteidigen, weil die
Regel nicht geschrieben war. Dazu kommt, dass das ⓘ heute ein passives
`mat-icon` mit nativem `title` ist: ein natives `title` hat **keinerlei**
Touch-Verhalten. Auf dem Tablet — dem Fall, für den das Antippen überhaupt
gedacht war — trägt das Zeichen also gar keine Information, der Tap ist der
einzige Weg, und er führt woandershin.

## Decision

> Das **Detail-Zeichen** (ⓘ) führt in **jeder** Fang-Tabelle zum
> **Detail-Dialog** — ohne Ausnahme, weil es das selbst verspricht.
>
> Der **Zeilenklick öffnet den Fang zum Bearbeiten**. Eine Tabelle darf davon
> abweichen, aber nur dort, wo Navigation laufende Arbeit zerstören würde — und
> die Abweichung gehört in diese ADR.

Das ⓘ wird dafür ein echter Knopf (`button type="button"` mit
`aria-haspopup="dialog"`) und schluckt seinen Klick. Sein zugänglicher Name
bleibt unverändert *das Bemerkenswerte* — was passiert, trägt `aria-haspopup`
und nicht ein Präfix im Namen: eine Liste mit 50 Zeilen soll nicht 50× dieselbe
Vorrede vorlesen. **♥ und ⚑ bleiben passiv** und lassen ihren Klick weiter zur
Zeile aufsteigen; für sie gilt #405 unverändert weiter („die Zeile trägt den
Klick, die Spalte trägt nur Information").

Die Regel liegt genau einmal im Code: ein geteilter **Öffner** in `shared/` ist
das Einzige, was den Detail-Dialog und seine Konfiguration kennt, und die
geteilte Marker-Komponente benutzt ihn. Eine Tabelle kann die Regel dadurch
nicht falsch verdrahten — und genau das war hier passiert.

## Considered options

- **Das ⓘ bekommt eine andere Aufforderung** und der Zeilenklick in „Letzte
  Fänge" bleibt der einzige Weg. Verworfen: der Tooltip ist auf dem Tablet
  unerreichbar, das Zeichen trüge dort dann gar nichts. Und „mehr erfahren"
  ohne Weg zum Mehr ist keine Aufforderung, sondern eine Notiz.
- **„Letzte Fänge" öffnet den Detail-Dialog auch beim Zeilenklick**, beide
  Tabellen also gleich. Verworfen: „Letzte Fänge" ist der Weg zur Korrektur
  eines eben erfassten Fangs; ein Dialog dazwischen macht aus einem Klick drei.
- **Der Detail-Dialog bekommt einen „Bearbeiten"-Knopf**, dann wäre der Umweg
  erträglich. Verworfen: er ist schreibgeschützt und soll es bleiben; der
  Zeilenklick in „Letzte Fänge" ist der direkte Weg und braucht keinen Umweg
  daneben.
- **Das ⓘ kennt die Optionale-Felder-Konfiguration** und verschweigt einen
  abgeschalteten Brutfleck. Verworfen in #468 und hier erneut: der Brutfleck
  wurde am Vogel erhoben, nicht am Formular (dieselbe Linie wie ADR 0035). Der
  Detail-Dialog ist das Einzige, was *jedes* Merkmal zeigt — deshalb ist er das
  richtige Ziel und nicht das Zeichen das falsche.
- **Die Regel nur als Template-Kommentar.** Verworfen: das war die bisherige
  Lage, und sie hat genau einmal funktioniert — bis das nächste Ticket eine
  Annahme darüberlegte.

## Consequences

- **Die Wiederfang-Historie weicht ab** und behält ihren Zeilenklick auf den
  Detail-Dialog: der Beringer steht mitten in einer Erfassung und würde den
  laufenden Fang verlieren (#405). Dass dort dadurch **zwei Wege** zum Dialog
  führen — das Detail-Zeichen und die Zeile —, ist die Vorhersage der Regel,
  nicht ihr Bruch: Tabellen-Aktion und Ziel des Detail-Zeichens fallen hier
  zusammen. Das ist kein Versehen und darf nicht aufgeräumt werden.
- **„Heute" fällt offline auf den Detail-Dialog zurück**, weil ein
  synchronisierter Fang offline nicht bearbeitbar ist (append-only, PRD #152).
  Das ist eine **Degradation des Defaults**, keine dritte Regel: online
  navigiert dieselbe Zeile wie überall in die Bearbeitungsmaske.
- **„Heute" trägt noch kein Detail-Zeichen** (und auch kein ♥ und ⚑) — die
  Marker-Konvention ist dort nie angekommen. Diese ADR beschreibt also
  ausdrücklich **zwei von drei** Fang-Tabellen und behauptet nicht, die
  Konvention gelte bereits überall; „Heute" nachzuziehen ist
  [#480](https://github.com/wasseramseleo/bird-doc-app/issues/480), mit eigenem
  Grilling.
- Die geteilte Marker-Komponente ist damit **nicht mehr rein präsentational**.
  Ihr Kopfkommentar sagt das jetzt auch — sonst wird der Knopf beim nächsten
  Durchlauf als Fehler zurückrepariert.
- Ob ein Klick zur Zeile aufsteigt, ist eine Eigenschaft der **Komposition** und
  auf der geteilten Komponente nicht beweisbar. Deshalb liegen zwei Pins auf
  Tabellenebene: „Letzte Fänge" navigiert beim Detail-Zeichen **nicht**, die
  Historie öffnet **genau einmal**. Dieses Issue existiert, weil die Verdrahtung
  ungetestet blieb, während die Komponente gut abgedeckt war.
