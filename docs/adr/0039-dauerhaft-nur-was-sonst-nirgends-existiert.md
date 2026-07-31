---
status: accepted
---

# Dauerhaft ist nur, was sonst nirgends existiert — deshalb rettet ein 401 den Erstfang

## Context

Ein Sitzungsablauf vernichtet heute einen Fang, den ein vollständiger Netzausfall
bewahrt hätte.

Der Facade-Docstring sagt es selbst
(`data-access-facade.service.ts`): nur ein echter Verbindungsabbruch
(`HttpErrorResponse.status === 0`) fällt auf die dauerhafte Outbox zurück — „any other
error (e.g. a 401, handled globally by the auth interceptor) propagates unchanged". Und
unverändert weitergereicht heißt: `authInterceptor` leert den Identitäts- und den
Referenz-Bundle-Cache und navigiert nach `/login`; der `unsavedChangesGuard` (#407) fragt
„Änderungen verwerfen?". Wer bestätigt, verliert den Fang. Wer ablehnt, sitzt auf einem
Formular mit toter Sitzung, das bei jedem weiteren Speichern erneut scheitert.

Der Vogel ist zu diesem Zeitpunkt beringt und wieder in der Luft. Der Datensatz existiert
nirgendwo sonst.

Gleichzeitig deckt die Outbox nur **Capture-Creates** ab. Ein Edit eines bereits
synchronisierten Fangs, eine Station, ein Projekt, eine Artennorm haben keinen dauerhaften
lokalen Ort — dass das so ist, war eine Scope-Entscheidung in PRD #152, wurde aber nie als
Regel formuliert. Ohne Regel hat die nächste Funktion keine Antwort.

## Decision

**Ein Schreibvorgang, dessen Inhalt sonst nirgends existiert, muss dauerhaft sein. Ein
Schreibvorgang, der nur ändert, was der Server bereits hält, darf laut scheitern.**

| dauerhaft | Begründung |
|---|---|
| Capture-Create | der Vogel ist weg |
| Beringer-Schnellanlage (#167) | dieselbe Begründung — an einer Station ohne Empfang angelegt |

| scheitert laut | Begründung |
|---|---|
| Capture-Edit | das Original ist unversehrt, die Korrektur steht noch im Formular |
| Station, Projekt, Artennorm | jederzeit in Ruhe erneut einzugeben |

**Daraus folgt unmittelbar: ein 401 auf einem Capture-Create legt den Eintrag in die
Outbox**, genau wie `status === 0` es tut, und erst danach kommt die Aufforderung zur
erneuten Anmeldung. Der Eintrag lebt als *nicht synchronisiert* weiter — bestehendes
Vokabular, bestehende Oberfläche, bestehender Replay unter demselben `accountKey` — und
überträgt sich nach der Anmeldung von selbst.

Das ist ADR 0033s eigener Grundsatz, angewandt auf den Online-Pfad: **dem Feld nie
anlasten, was das System getan hat.** Eine abgelaufene Sitzung ist eine Bedingung des
Systems; der Fang ist einwandfrei.

## Considered options

- **Universelle Outbox — jeder Schreibvorgang wird dauerhaft.** Vollkommen einheitlich,
  eine Regel zu erklären, nirgends geht etwas verloren. Verworfen: eingereihte Edits
  brauchen eine Konfliktbehandlung, die der Create-Pfad nie gebraucht hat, und eine Tage
  später zurückgespielte Projekt-Umbenennung, die gegen veränderte Daten läuft, ist eine
  neue Klasse von Überraschung.
- **Nichts Neues — weiterhin nur Capture-Creates, wie heute.** Keine neue Persistenz,
  kleinste Fläche. Verworfen: es formuliert keine Regel, also hat die nächste Funktion
  wieder keine Orientierung — und der 401-Datenverlust bliebe bestehen.
- **Entwurf speichern und nach der Anmeldung wiederherstellen.** Deckt Create *und* Edit
  mit einem Mechanismus ab und lässt die Outbox unangetastet. Verworfen: es erfindet eine
  **zweite** Art dauerhaft gehaltener, noch nicht übertragener Fangdaten neben der Outbox
  — zwei Dinge, die beide „noch nicht am Server" bedeuten. Genau diese Zweideutigkeit
  vermeidet CONTEXT.md, indem es die Warteschlange bewusst gar nicht erst benennt.
- **Im Formular anmelden, ohne es zu verlassen** (Inline- oder Modal-Anmeldung, danach
  automatischer erneuter Versuch). Nichts kann verloren gehen, und Edits wären mit
  abgedeckt. Verworfen: eine zweite Anmeldefläche zum Bauen, Testen und Absichern, und der
  globale Redirect des Interceptors müsste eine Ausnahme lernen.
- **Pro Bildschirm entscheiden.** Verworfen: maximale Passgenauigkeit, aber kein Prinzip,
  auf das man zeigen kann, sobald die Antworten anfangen einander zu widersprechen.

## Consequences

- Die Outbox nimmt jetzt auch bei einem 401 an, nicht nur bei `status === 0`. Die
  bestehende `accountKey`-Bindung trägt das unverändert: meldet sich ein **anderes** Konto
  an, spielt es die Einträge des vorigen nicht zurück.
- Ein Capture-**Edit**, der auf einen 401 läuft, scheitert weiterhin laut. Das Original
  bleibt unversehrt, die Korrektur steht noch im Formular — sie muss nach der Anmeldung
  erneut abgeschickt werden.
- **Der globale Redirect lernt genau eine Ausnahme**, und sie ist enger als die
  Dauerhaftigkeit: *dieser Fehlschlag wird an der Geste gemeldet*
  (`SESSION_EXPIRY_AT_THE_GESTURE`, ADR 0037). Wer sie trägt, bekommt kein
  `currentUser.set(null)` und keinen Sprung nach `/login` — sonst käme beides *vor* der
  Rettung (Create) beziehungsweise *statt* des Banners (Edit), wo die Navigation den
  `unsavedChangesGuard` über eine Korrektur fragen ließe, die sonst nirgends steht.
  Getragen wird sie von den beiden dauerhaften Schreibvorgängen **und** vom Capture-Edit;
  Station, Projekt und Artennorm tragen sie nicht. Abgemeldet wird am Knopf „Anmelden" im
  Banner (`AuthService.sessionExpired()`).
- **Der Zwischenspeicher der Identität ist von dieser Ausnahme ausgenommen** und wird bei
  jedem 401 sofort geleert (#156/#158). Sonst überdauerte er auf dem geteilten Tablet ein
  Mitglied, das die Runde beendet und den Deckel zuklappt, ohne „Anmelden" gedrückt zu
  haben — der nächste Kaltstart ohne Empfang meldete den Vorigen wieder an, samt seiner
  Warteschlange. Die Rettung braucht ihn nicht: die Outbox reiht unter
  `AuthService.currentUser()` ein, dem Signal im Speicher. Das **Referenz-Bündel** bleibt
  dagegen stehen — aus ihm erfasst das Mitglied weiter, bis es sich neu anmeldet.
- Eine offline oder bei toter Sitzung angelegte Station bleibt verloren. Bewusst.
- Die Regel gibt der nächsten Funktion eine Antwort, ohne die Diskussion neu zu führen:
  existiert der Inhalt sonst nirgends?
- Der Idempotenzschlüssel des Formulars läuft unverändert weiter — der in die Outbox
  gelegte Eintrag trägt seinen eigenen, und der Replay ist damit gegen den Fall gesichert,
  dass der ursprüngliche Request den Server doch noch erreicht hat.
