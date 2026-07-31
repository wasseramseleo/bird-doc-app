---
status: accepted
---

# Fehlercodes reisen additiv neben der DRF-Form, und ein Fehler trägt seinen Kontext selbst

## Context

Die Leitung trägt heute ausschließlich deutsche Prosa. Eine zurückgewiesene Ringnummer
kommt als `{"ring_number": ["Für diese Ringnummer besteht in dieser Organisation bereits
ein Erstfang."]}` an — ein Satz, sonst nichts. Damit der Client eine Abhilfe anbieten
kann („Als Wiederfang", „freie Nummer übernehmen", den kollidierenden Erstfang zeigen),
muss er zuerst **wissen, welcher Fehler das ist**. Aus Prosa kann er das nur durch
Textvergleich schließen, und dann bricht jede Textkorrektur still jede Abhilfe, ohne
dass ein Test anschlägt.

Dabei ist die Information vorhanden und wird nur weggeworfen: DRFs `ErrorDetail` ist eine
`str`-Unterklasse, die einen `.code` trägt (`required`, `blank`, `invalid_choice`,
`max_length`, `unique`, …). Der ausgelieferte `EXCEPTION_HANDLER` ist der unveränderte
`rest_framework.views.exception_handler`, und der serialisiert nur die Zeichenkette.

Die Zurückweisungen von Hand sind überschaubar: **25 explizite `raise`-Stellen**, 5
`error_messages`-Wörterbücher, 14 Meldungskonstanten.

Die Randbedingung kommt aus ADR 0033: ein Gerät kann rund 30 Tage offline sein, und das
Bundle, das einen Monat alten Payload zurückspielt, **ist** das alte Bundle.
`sync.service.ts:423` liest heute `{field: [string]}` und `{detail: …}`. Was auch immer
hinzukommt, darf diese Form nicht antasten.

## Decision

**Ein globaler `EXCEPTION_HANDLER`.** Eine Einstellung, und jeder Endpunkt trägt sofort
DRFs eigene Codes — gratis, ohne eine einzige Zeile pro View. Die 25 Stellen bekommen in
einem Durchgang ausdrückliche Domänencodes (`ring_already_first_caught`,
`ring_size_invalid_austrian`, `admin_only`, `no_active_organisation`, `csrf_failed`, …).

**Additiv, nie ersetzend.** Der Umschlag kommt als Geschwisterschlüssel dazu; `{field:
[string]}` bleibt **byteweise identisch**. Ein Bundle von letztem Monat sieht unter
ADR 0033 keinerlei Veränderung.

```jsonc
HTTP 400
{
  "ring_number": ["Für diese Ringnummer besteht … bereits ein Erstfang."],  // unverändert
  "errors": [
    { "field": "ring_number",
      "code":  "ring_already_first_caught",
      "detail": "Für diese Ringnummer besteht … bereits ein Erstfang.",
      "context": { "rival": { "id": "…", "date_time": "2026-07-28T08:15",
                              "species": "Teichrohrsänger", "staff": "FRE" } } }
  ]
}
```

**Der Server sagt, WAS falsch ist; der Client sagt, WAS ZU TUN ist.** Nur der Server
kennt die Invariante; nur der Client weiß, was gerade auf dem Bildschirm steht und welche
Geste dort überhaupt möglich ist. Der Code ist die Naht dazwischen — stabil über
Textkorrekturen und Übersetzungen hinweg.

**Ein Fehler trägt seinen Kontext selbst.** Wo eine Abhilfe Daten braucht, reist ein
optionales, typisiertes `context` mit — für `ring_already_first_caught` der kollidierende
Erstfang. Kein Nachfassen: eine zweite Anfrage kann selbst scheitern, und ein Fehler über
den Fehler ist das schlechteste erreichbare Ergebnis. Selbsttragend heißt außerdem
**vollständig persistierbar**: der Umschlag wird auf den geflaggten `OutboxEntry`
geschrieben, sodass ein Tage später wieder geöffneter zurückgewiesener Eintrag dasselbe
vollständige Banner zeigt — ganz ohne Netz.

**Ein unbekannter Code degradiert auf `detail`.** Ein Client, der einen Code nicht kennt,
zeigt den Satz und bietet keine Abhilfe an. Nie leer, nie ein Rohstatus.

## Considered options

- **RFC 9457 Problem Details** (`type`/`title`/`status`/`detail`/`instance` + Extensions).
  Standardisiert, dokumentiert, sofort vertraut. Verworfen: es verdrängt die
  feldgeschlüsselte DRF-Form, auf der Client *und* die gesamte bestehende Testsuite
  aufsetzen — für eine private API mit genau einem Konsumenten.
- **Prosa im Client abgleichen.** Keinerlei Backend-Arbeit, schnellste Auslieferung.
  Verworfen: eine Textkorrektur oder eine Übersetzung degradiert still jede Abhilfe auf
  einen nackten Satz, und kein Test würde das bemerken.
- **Den Kontext im Client nachladen** über das vorhandene, offline-fähige
  `getRingHistory(size, number)`. Keine neue Backend-Fläche über den Code hinaus,
  wiederverwendet einen getesteten Pfad. Verworfen: ein zweiter Roundtrip, der selbst
  scheitern kann — und `OutboxEntry.syncError` ist heute eine Zeichenkette, ein wieder
  geöffneter geflaggter Eintrag müsste also erneut ans Netz.
- **Der Server liefert die ganze Abhilfe** (Meldung, Aktionen, deren Daten). Am
  informativsten ohne Domänenlogik im Client. Verworfen: es legt UI-Entscheidungen nach
  Django, und eine Abhilfe wie „setze in diesem Formular den Status auf Wiederfang" kann
  der Server sinnvoll gar nicht beschreiben.
- **Nur die Capture-Endpunkte, ohne globalen Handler.** Kleinster Radius. Verworfen: die
  gratis mitgelieferten DRF-Codes blieben liegen, und der Umschlag müsste beim nächsten
  Bedarf neu gebaut werden.
- **Global den Handler, Domänencodes nur für den Capture-Pfad.** Verworfen: der Client
  könnte dann „Code, den ich nicht kenne" nicht von „Endpunkt, der keine Codes hat"
  unterscheiden — und sein Rückfallverhalten unterscheidet sich für die beiden.

## Consequences

- Ein veröffentlichter Code ist **Vertrag**. Umbenennen ist ein Bruch und braucht dasselbe
  Offline-Fenster-Denken wie ADR 0031 für ein zurückgezogenes Vokabular.
- `OutboxEntry.syncError` wird von einer Zeichenkette zu einer Struktur. Das ist eine
  Formänderung im IndexedDB-Datensatz (`OFFLINE_DB_VERSION`); ein zuvor geschriebener
  String muss weiter lesbar bleiben und als reines `detail` ohne Code gelten.
- Die fünf handgeschriebenen Extraktoren (`stationen.ts`, `beringer.ts`, `artennormen.ts`,
  `import-iwm-dialog.ts`, `sync.service.ts::extractServerMessage`) haben ab jetzt eine
  gemeinsame Quelle, gegen die sie eingezogen werden können.
- Die Einordnung wird **einmal** gegen echte DRF-Antwortkörper unit-getestet, statt pro
  Bildschirm nachgebaut zu werden.
- Jede API-Antwort im Fehlerfall wird größer. Für einen 400er in einem Formularablauf
  ohne Bedeutung.
