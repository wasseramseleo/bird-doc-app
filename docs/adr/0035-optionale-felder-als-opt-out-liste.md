---
status: accepted
---

# Optionale Felder pro Projekt: eine Opt-out-Liste statt weiterer Booleans

## Context

Die Sichtbarkeit der Fangformularfelder wurde bisher von **zwei** unabhängigen
Booleans am Projekt gesteuert:

- `show_optional_fields` — alles oder nichts für einen Block aus sechs Feldern
  (Brutfleck, CPL+, Hungerstreifen, Parasit, Kerbe F2, Innenfuß)
- `show_net_fields` — der Netz-Block (Netznr., Netzfach, Flugrichtung), nachträglich
  danebengestellt (ADR 0023)

Aus dem Beta-Feedback: die Alles-oder-nichts-Kopplung passt nicht. Ein Projekt will
Parasit sehen, aber nicht Hungerstreifen, CPL+ und Kerbe. Der Weg des geringsten
Widerstands wäre ein dritter, vierter, fünfter Boolean gewesen — genau das Muster,
das die zwei bestehenden erzeugt hat.

## Decision

**Ein Mechanismus statt zweier.** Beide Booleans werden zurückgezogen und durch **eine
Liste ausgeblendeter Feldschlüssel** am Projekt ersetzt, über einem festen,
serializer-validierten Vokabular von sieben Einträgen: Brutfleck, CPL+,
Hungerstreifen, Parasit, Kerbe F2, Innenfuß und **Netz-Block** (die drei Netzfelder
als *ein* Eintrag — sie werden nie einzeln gewollt).

**Gespeichert wird, was abgewählt ist (Opt-out), nicht was gewählt ist.** Leere Liste =
alles sichtbar. Das entspricht der Haltung, die `show_net_fields` schon hatte
(„default on, damit jedes bestehende Projekt weiter alles zeigt"), und ein später
hinzukommendes optionales Feld ist überall automatisch sichtbar — ohne Backfill-
Migration über jedes Projekt.

**Der Kern bleibt unabschaltbar.** Nur die sieben oben. Spine (Station, Beringer,
Datum, Art, Ringstatus, Zentrale, Ringgröße, Ringnummer, Bemerkung) identifiziert den
Datensatz; Kern (Alter, Geschlecht, Fett, Muskel, Kleingefieder, Handschwingen,
Tarsus, Teilfederlänge, Flügellänge, Gewicht) speist die Datenmeldung und die
Artennorm-Prüfungen.

**Keine Projekttyp-Vorbelegung.** ADR 0023 erlaubt dem Typ, den Default zu *seeden*;
diese Erlaubnis bleibt ungenutzt — dieselbe Entscheidung, die ADR 0029 für die Saison
getroffen hat.

**Harter Schnitt statt Übergangsfenster.** Beide Booleans verschwinden sofort aus
Modell *und* Payload, ohne die abgeleitete Weiterlieferung, die ADR 0031 beim
Milben-Code über das ~30-Tage-Offline-Fenster gefahren hat.

## Considered options

- **Volle Formularkonfiguration (~20 Felder abschaltbar).** Maximal flexibel, etwa für
  Nestlingsberingung. Verworfen: ein Projekt könnte Gewicht ausblenden und still eine
  Datenmeldung mit leerer Gewichtsspalte abliefern — und sich die eigenen
  Plausibilitätsprüfungen abschalten.
- **Nur den Optional-Block aufteilen, `show_net_fields` daneben stehen lassen.**
  Kleinster Diff. Verworfen: zwei Mechanismen für dieselbe Aufgabe sind genau, wie ein
  dritter entsteht.
- **Ein Boolean pro Feld (sieben Spalten).** Explizit, typisiert, im Django-Admin
  gratis gerendert. Verworfen: eine Migration pro neuem Feld — der Pfad, der die zwei
  Ad-hoc-Booleans hervorgebracht hat.
- **Positivliste (gespeichert wird, was sichtbar ist).** Liest sich natürlicher und
  entspricht der Checkbox-UI 1:1. Verworfen: jedes künftig hinzugefügte optionale Feld
  startet auf jedem bestehenden Projekt unsichtbar und braucht eine Backfill-Migration.
- **Eigene `ProjectFieldVisibility`-Tabelle.** Verworfen: ein Join für etwas, das das
  Offline-Bundle ohnehin inline mit jedem Projekt ausliefern muss.
- **Beide Booleans ein Offline-Fenster lang abgeleitet weiterliefern (Muster ADR 0031).**
  Verworfen als unnötig: ein Gerät auf alter Version liest `show_optional_fields ?? true`
  und fällt damit auf „alles anzeigen" zurück — falsch, aber harmlos, und ADR 0032
  erklärt so ein Gerät ohnehin als nicht offline bereit.

## Consequences

- Ein Gerät auf veralteter Version zeigt für einen Update-Zyklus **alle** optionalen
  Felder, unabhängig von der Projektkonfiguration. Bewusst in Kauf genommen.
- Ausblenden ist **rein darstellend**: auf historischen Fängen gespeicherte Werte
  bleiben unangetastet und werden weiter exportiert — wie beim zurückgezogenen
  Netzfelder-Schalter.
- Ein ausgeblendetes Kerbe F2 / Innenfuß kann keine Plausibilitätswarnung mehr
  auslösen: es gibt keine Eingabe mehr, gegen die geprüft würde.
- Ein achtes optionales Feld kostet künftig einen Vokabulareintrag und keine Migration.
