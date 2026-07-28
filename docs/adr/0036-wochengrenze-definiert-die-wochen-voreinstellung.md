---
status: accepted
---

# Die Wochengrenze definiert die Wochen-Voreinstellung des Dashboards

## Context

Die Voreinstellung „Letzte Woche" war weder das eine noch das andere: sie zeigte
`heute − 7 Tage … heute`, ein **rollendes Sieben-Tage-Fenster**, das an einem Mittwoch
von Mittwoch bis Mittwoch lief. Sie ist zugleich `DEFAULT_PRESET` — die erste Ansicht,
die jedes Dashboard zeigt.

Aus dem Beta-Feedback: der Beringungsbetrieb läuft in Wochen von **Samstag 12:00 bis
Samstag 12:00**. Am Ende so einer Woche schleppt das rollende Fenster die Vögel des
Samstagvormittags der *Vorwoche* in die Zahlen dieser Woche. Gefragt war eine
Uhrzeitangabe im „von–bis"-Feld; der eigentliche Schmerz lag bei „Letzte Woche".

## Decision

**Ein Projekt trägt eine Wochengrenze** — Wochentag plus Uhrzeit (Europe/Vienna),
manuell gesetzt, Admin-only, neben dem Saison-Fenster und nach demselben Muster
(ADR 0029).

**Die Wochen-Voreinstellung heißt „Diese Woche" und meint: von der letzten
Wochengrenze bis jetzt.** Ein laufender Bereich, wie „Diese Saison" während der
Saison — bewusst **nicht** die letzte abgeschlossene Woche, denn gefragt war die
Sicht am Ende der laufenden Woche.

**Jedes Projekt hat eine Wochengrenze; unkonfiguriert heißt Montag 00:00.** Die
Voreinstellung hat damit **eine** Bedeutung, überall — sie hängt nie an unsichtbarer
Konfiguration.

**Die Wochengrenze steuert ausschließlich diese eine Voreinstellung.** Heute bleibt ein
Kalendertag; Monat, Jahr, Alles und Saison behalten ihre Mitternachtsgrenzen. Der
freie „von–bis"-Bereich bleibt tagesgenau.

## Considered options

- **Nur Uhrzeitfelder am freien von–bis-Bereich** (das wörtlich Gefragte). Klein und
  flexibel. Verworfen: die Sa-12:00-Grenze müsste bei jeder Abfrage neu getippt
  werden, und „Letzte Woche" bliebe falsch.
- **Nur die Preset-Semantik reparieren** (vorige Kalenderwoche statt rollender sieben
  Tage), ohne Uhrzeit. Verworfen: läge für diesen Rhythmus immer noch zwölf Stunden
  daneben.
- **Die letzte *abgeschlossene* Woche zeigen** (Sa 12:00 → Sa 12:00). Entspricht dem
  Etikett „Letzte Woche" wörtlich und ergibt ein stabiles Berichtsfenster. Verworfen:
  mitten in der Woche sähe man nichts über die Woche, in der man steckt.
- **Zwei Knöpfe, „Diese Woche" und „Letzte Woche".** Verworfen: eine Knopfleiste, die
  schon fünf bis sechs Einträge trägt.
- **Unkonfiguriert = bisheriges rollendes Fenster.** Blast Radius null. Verworfen:
  derselbe Knopf bedeutete dann je nach unsichtbarer Konfiguration zweierlei.
- **Unkonfiguriert = Montag 00:00, aber Rückfall auf die letzte nicht-leere Woche.**
  Nie eine leere Startansicht. Verworfen: ein Bereich, der still nicht das ist, was
  das Etikett sagt.
- **Wochengrenze an der Organisation** (so beschrieben: ein Rhythmus für den ganzen
  Betrieb) oder **an der Organisation mit Projekt-Override**. Verworfen: die
  Organisation trägt heute keine Dashboard-Konfiguration, und die zweischichtige
  Override-Form hat sich in derselben Feedback-Runde bereits als Falle gezeigt (eine
  Artennorm-Override beschattet ihren globalen Standard dauerhaft).

## Consequences

- **„Letzte Woche" verschwindet als Startansicht für jeden Mandanten**, nicht nur für
  das Projekt, das eine Wochengrenze setzt. Montagfrüh sieht das Dashboard nahezu leer
  aus, wo es bisher immer etwas zeigte. Bewusst eingegangen, um die Doppelbedeutung
  hinter einem Knopf zu vermeiden.
- Ein **Fangtag** an der Wochengrenze wird auf zwei Wochenansichten aufgeteilt: derselbe
  Samstag erscheint als zwei Teilbalken, vormittags in der einen, nachmittags in der
  anderen. Ein Fangtag bleibt ein Kalendertag — eine Fangwoche ist deshalb *nicht*
  „sieben Fangtage".
- Die Bereichsgrenzen des Dashboards sind nicht mehr Mitternacht: `from`/`to` werden
  zu Zeitpunkten, nicht Datumsangaben.
- Eine Wochengrenze, die auf eine Sommerzeitumstellung fällt (Sonntag 02:00–03:00), ist
  zweimal im Jahr mehrdeutig oder nicht existent. Samstag 12:00 ist es nie; die
  Auflösungskonvention gehört bei der Umsetzung festgelegt.
