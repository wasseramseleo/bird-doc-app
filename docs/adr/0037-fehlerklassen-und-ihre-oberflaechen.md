---
status: accepted
---

# Fehler werden danach benannt, was dagegen zu tun ist — sechs Klassen, Oberfläche nach Moment

## Context

Der interaktive Speicherpfad hat keine Fehlerbehandlung. `data-entry-form.ts:1821`
rendert `err.message` — die Transportzeichenkette von Angular — und produziert damit
„Fehler beim Speichern: Http failure response for …/data-entries/: 400 OK". Der Server
hatte in genau diesem Fall längst einen präzisen deutschen Satz geliefert
(`capture_service.py:71`, `RING_ALREADY_FIRST_CAUGHT`, feldgebunden an `ring_number`);
der Client hat ihn weggeworfen.

**Der Offline-Pfad ist heute besser als der Online-Pfad.** ADR 0033 hat dem Replay eine
durchdachte Taxonomie gegeben — die Trennlinie „Bedingung des *Eintrags* oder Bedingung
des *Laufs*", mit einer bewussten Positivliste (400/422 verdienen einen
Synchronisierungsfehler; 401 → erneute Anmeldung; 404 → Version veraltet; 429 →
zurückhalten; alles andere → stiller Wiederholungsversuch). Dieselbe Zurückweisung,
online ausgelöst, bekommt eine Snackbar mit Transportmüll.

Das ist kein Einzelfall, sondern das Muster:

- **Vier handgeschriebene Extraktoren** — `stationen.ts:127`, `beringer.ts:327/335/344`,
  `artennormen.ts:175`, `import-iwm-dialog.ts:105` — graben jeweils eigenhändig ein
  `detail` oder Feldfehler aus, plus `sync.service.ts:423` als fünfter.
- **Ladefehler sind unsichtbar.** `stationen.ts:149`, `beringer.ts`, `artennormen.ts`
  und `project-picker.ts` setzen `loading` zurück und toasten drei Sekunden — danach
  rendert eine **leere Liste**. „Es sind noch keine Stationen angelegt" und „Stationen
  konnten nicht geladen werden" sehen identisch aus. Nur `data-entry-list` und
  `data-entry-form` haben seit #385 einen echten Fehlerzustand.
- **54 `snackBar.open`-Aufrufe** ohne jede Regel darüber, was eine Snackbar tragen darf.
- **403 ist überladen**: eine Rechteverweigerung (`ADMIN_ONLY_MESSAGE`) und eine
  CSRF-Ablehnung sind derselbe Status mit gegensätzlichen Auswegen.

## Decision

**Ein Fehler wird danach klassifiziert, was das Mitglied dagegen tun kann** — nicht
danach, was technisch passiert ist. Der HTTP-Status ist *Evidenz* für die Einordnung,
niemals die Einordnung selbst. Das verallgemeinert ADR 0033s Entry-vs-Run-Linie von der
Replay-Schleife auf die ganze SPA.

**Sechs Fehlerklassen**, jede mit genau einem Ausweg, damit die Meldung sich von selbst
schreibt:

| Klasse | Ausweg | typische Evidenz |
|---|---|---|
| **Korrigieren** | hier und jetzt berichtigen | 400/422 |
| **Erneut versuchen** | warten oder nochmal drücken | 5xx, 429, CSRF, Verbindungsabbruch |
| **Neu anmelden** | anmelden und zurückkommen | 401 |
| **Freigeben lassen** | eine **namentlich genannte** Person bitten | 403 `permission_denied`, keine aktive Organisation |
| **App aktualisieren** | „Jetzt aktualisieren" drücken | 404 auf bekanntem Endpunkt, veraltete Version |
| **Unbekannt** | nichts — es liegt an uns; „Fehler melden" | alles übrige |

**Die Klasse bestimmt die Worte, der Moment die Oberfläche.** Zwei unabhängige Achsen:

| Moment ↓ / Klasse → | Korrigieren | Erneut versuchen | Neu anmelden | Freigeben lassen | App aktualisieren | Unbekannt |
|---|---|---|---|---|---|---|
| **Ausgelöste Schreibung** | Feld + Banner | Banner | Banner + Anmelden | Banner, nennt Admins | Banner | Banner + Fehler melden |
| **Laden im Hintergrund** | — | an Ort und Stelle + Erneut laden | an Ort und Stelle | an Ort und Stelle | an Ort und Stelle | an Ort und Stelle |
| **Dauerzustand** | — | Banner | Banner | — | Banner | — |

**Das Banner ist dasselbe Bauteil, online wie offline.** Das bestehende
`sync-error-banner` (`data-entry-form.html:7`, `role="alert"`) wird verallgemeinert: eine
Zurückweisung sieht gleich aus, ob sie beim Speichern oder beim Replay entstanden ist.
Das fehlerhafte Feld trägt zusätzlich den Serversatz und wird rot — gesetzt als
Server-Fehler auf dem Control, **gelöscht, sobald genau dieses Feld bearbeitet wird**.
Eine Zurückweisung ohne einzelnes Feld (etwa Erstfang gegen Projekt-Zentrale) rendert
nur das Banner.

**Eine Abhilfe füllt das Formular und speichert nie.** Ein Knopf darf `Status = w`
setzen oder eine freie Nummer eintragen; drücken muss das Mitglied selbst. „Als
Wiederfang" ändert die wissenschaftliche Aussage des Datensatzes — das bleibt sichtbar,
widerruflich und bewusst. (Es fügt sich gratis in #155: ändert sich der Formularinhalt
nach einem gescheiterten Versuch, wird ohnehin ein frischer Idempotenzschlüssel geprägt.)

**Snackbars bestätigen; sie erklären nie einen Fehlschlag.** Eine flüchtige Meldung darf
sagen, dass etwas *gelungen* ist, sonst nichts. Jeder Fehlschlag bekommt eine Oberfläche,
die bleibt, bis er behandelt ist — nichts, worauf reagiert werden muss, verfällt nach
drei Sekunden, während ein Mitglied beide Hände am Vogel hat. Die Regel ist ohne Kenntnis
der Taxonomie prüfbar.

**Der leere und der kaputte Zustand bekommen verschiedene Vögel.** Zwei benannte
App-Icons — `app-icon-error` und `app-icon-empty` — an genau einer Stelle definiert.
Bis die gezeichneten Vögel (`icon/error`, `icon/keine-fänge`) als SVG vorliegen, stehen
Material-Icons dahinter; der Tausch ist eine Datei. Damit ist „hier ist noch nichts"
von „hier ist etwas kaputt" auf jedem Bildschirm auf den ersten Blick unterscheidbar.

**„Freigeben lassen" nennt Personen.** Dafür werden die **Admins der eigenen
Organisation** (Name und Kürzel) für jedes Mitglied dieser Organisation lesbar. Bislang
kann ein Mitglied nicht herausfinden, wen es fragen soll: `OrganizationSerializer` führt
nur `id/handle/name/country`, und `/mitgliedschaften/` ist Admin-only. Die Freigabe ist
strikt auf die **eigene** Organisation begrenzt (ADR 0005).

**Grenze: nur die Angular-SPA.** Die Landing-App (Registrierung, Einladung annehmen,
Passwort-Reset) bleibt bei ihren Django-Formularen. Dort sind es einmalige öffentliche
Abläufe, in denen ein Fehlschlag ein erneutes Tippen kostet, keinen Vogel. Das ist eine
Entscheidung, kein Versehen.

**Eine Warnung ist keine Fehlerklasse.** Die Plausibilitätswarnung entsteht rein am
Gerät, blockiert nie und bleibt außerhalb dieser Taxonomie.

## Considered options

- **Nach HTTP-Status klassifizieren.** Mechanisch vollständig und trivial testbar.
  Verworfen: der Status ist ein Detail des Transports — eine doppelte Ringnummer und eine
  fehlerhafte Dezimalzahl sind beide 400 und brauchen gegensätzliche Meldungen. 403 ist
  der Beweis: Rechte und CSRF teilen ihn und haben nichts gemeinsam.
- **Nach Oberfläche klassifizieren** (inline / Dialog / Banner / Seite). Verworfen:
  entscheidet die Darstellung, bevor feststeht, was zu sagen ist.
- **ADR 0033 wörtlich übernehmen — zwei Klassen.** Minimal und perfekt konsistent.
  Verworfen: „Bedingung des Laufs" umfasst dann 401, 403, 429, 5xx und Offline mit einer
  Meldung — genau die Unschärfe, die hier beseitigt werden soll.
- **Keine Klassen, eine handgeschriebene Meldung pro bekanntem Fall.** Höchste Qualität,
  wo abgedeckt. Verworfen: der unerkannte Fall ist auf Dauer die Mehrheit und hätte keine
  entworfene Antwort — das ist der heutige Zustand.
- **Blockierender Dialog für Zurückweisungen.** Unübersehbar und der natürliche Ort für
  Abhilfe-Knöpfe. Verworfen: er verdeckt das Formular, auf das geschaut werden muss, und
  CONTEXT.md reserviert das Modal-Idiom für die weiche Plausibilitätswarnung.
- **Doppelte Ringnummer vorab beim Verlassen des Feldes prüfen.** Die Maschinerie ist da
  und bewusst abgeschaltet (#273: „Only on a Wiederfang; an Erstfang blur does nothing").
  Verworfen: der Ring sitzt bereits am Vogel, wenn die Nummer getippt wird — drei
  Sekunden früher zu erfahren ändert die Abhilfe nicht, und eine Vorprüfung kann nie
  autoritativ sein (nebenläufiges Gerät, offline). Eine zweite Meinung über dieselbe
  Tatsache, die der ersten widersprechen kann, in den häufigsten Ablauf der App.
- **Ein-Klick-Abhilfen, die gleich speichern.** Am schnellsten in einer laufenden Runde.
  Verworfen: ein Fehlgriff meldet einen Wiederfang für einen nie zuvor gefangenen Vogel.
- **Nur die Rolle nennen statt der Person** („wende dich an eine:n Admin"). Verworfen:
  in einer Organisation mit zwanzig Mitgliedern ist das ein Achselzucken.

## Consequences

- Jede Fehlerstelle in der SPA bekommt eine Klasse. Ein unerkannter Fall fällt auf
  **Unbekannt** und beschuldigt damit **nie die Eingabe** — dieselbe Haltung wie ADR 0031
  und ADR 0033: dem Feld nie anlasten, was das System getan hat.
- **429 hat heute keinen Erzeuger** (keine DRF-Throttles; ADR 0007 hat Cloudflare
  entfernt). Die Klasse existiert und bleibt vorerst ungenutzt — bewusst, nicht vergessen.
- Fehlermeldungen wandern aus der Snackbar in die Fläche. Das kostet pro Bildschirm
  Layout-Arbeit, die eine Snackbar nicht gekostet hat.
- Die Namen der Admins einer Organisation sind neue personenbezogene Daten auf der
  Leitung — innerhalb eines Tenants, unter Kolleg:innen, die sich gegenseitig per E-Mail
  eingeladen haben, aber neu.
- Der Fehlerzustand „an Ort und Stelle mit Erneut laden" ersetzt in vier Bildschirmen die
  bisher leer gerenderte Liste. Wer bisher aus einer leeren Liste auf „noch nichts
  angelegt" geschlossen hat, sieht jetzt die Wahrheit.
- Die Landing-App und die SPA behandeln Fehler ab jetzt unterschiedlich. Nachgeschlagen
  werden kann das hier.
