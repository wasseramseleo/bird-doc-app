---
status: accepted
---

# Die Oberfläche schreibt Beringer:in — vier Schreibweisen, jede mit ihrem Geltungsbereich

## Context

Dieselbe Person heißt im Produkt an vier Stellen verschieden. Nicht entschieden,
sondern gewachsen:

- **`Beringer`** — 79× in Templates: Formularbeschriftung, Fehlermeldungen,
  Tabellenköpfe, Verwaltungsseiten.
- **`Beringer:in` / `Beringer:innen`** — im IWM-Import-Dialog, in `iwm_import.py`
  und in Serverzurückweisungen („Ein Projekt braucht mindestens **eine:n
  Beringer:in**."); daneben „eine:n Administrator:in" in `views.py`.
- **`Wissenschaftler:innen`** — als Feldbeschriftung in den Projekt-Dialogen, für
  genau die Beringer-Menge eines Projekts. Ein Verstoß gegen `_Avoid_: Scientist`
  im Glossareintrag **Beringer**, nur auf Deutsch.
- **`Beringerinnen und Beringer`** — Landing, AGB, Impressum, Datenschutz; im
  Wissen-Glossar zusätzlich generisches Femininum („die Beringerin").

Dazu, unantastbar: die Spalte **`BeringerIn`** in der IWM-Datei — Binnen-I, weil
die Meldestelle das Format setzt und nicht wir.

Aus dem Beta-Feedback kam die Bitte, „Beringer" durch „BeringerIn" zu ersetzen
(inklusiver). Der Anlass ist berechtigt: das allein stehende generische
Maskulinum steht an 79 Stellen der Oberfläche.

## Decision

Es bleiben vier Schreibweisen — aber jede bekommt ihren Geltungsbereich, und der
wird hier festgehalten statt beim nächsten Durchlauf neu erraten.

1. **App-Oberfläche: `Beringer:in` / `Beringer:innen`.** Beschriftungen,
   Fehlermeldungen, Tabellenköpfe, Dialoge — im Angular-Frontend wie in den
   Django-Meldungen, die ein Mitglied zu sehen bekommt. Dazu die Fälligkeit:
   `Wissenschaftler:innen` → `Beringer:innen`.
2. **Öffentliche Prosa: die Paarform bleibt.** Ersetzt wird dort **nur das allein
   stehende generische Maskulinum** — „Für Beringer", „Ungefähre Anzahl
   Beringer", „Für wie viele Beringer sprichst du ungefähr?" — durch die
   Doppelpunktform. Was bereits „Beringerinnen und Beringer" schreibt, bleibt.
3. **IWM-Datei: `BeringerIn`.** Dateiformat, keine Sprachentscheidung.
4. **Domäne, Modell, Code, ADRs, `CONTEXT.md`: `Beringer`.** Dieselbe Trennung,
   die die bestehende `_Code note_` im Glossar schon zwischen Domänenbegriff und
   Codenamen (`Scientist`, `/scientists/`, `staff`) zieht.

**Warum Doppelpunkt und nicht Binnen-I**, obwohl das Feedback Binnen-I wünschte
und die Meldedatei es schreibt: Binnen-I löst nur das Substantiv. Artikel und
Adjektiv bleiben unerledigt — „Unbekannter BeringerIn" ist falsch, „Unbekannte(r)
BeringerIn" eine Krücke, und „eine:n" hat gar keine Binnen-I-Entsprechung. Der
Doppelpunkt trägt die Deklination mit („eine:n Beringer:in", „Unbekannte:r
Beringer:in"), ist die derzeit empfohlene barrierearme Variante, und die App
spricht ihn an vier Stellen bereits — es ist die einzige Option, bei der nichts
zurückzurollen ist.

**Warum die öffentliche Prosa nicht mitzieht:** die Paarform *ist* die inklusive
Form und für Screenreader die sauberste. Das **Wissen** richtet sich laut Glossar
ausdrücklich auch an Suchmaschinen und Antwortmaschinen; ein Doppelpunkt im Wort
macht eine zitierfähige Referenz dort schlechter, nicht besser. Und jeder
geänderte deutsche Satz ist eine gebrochene `msgid` samt englischer Übersetzung —
für Texte, die das Ziel bereits erfüllen, und teilweise für Rechtstexte, die
niemand anzufassen gebeten hat.

## Considered options

- **Binnen-I überall (der Wortlaut des Feedbacks).** Deckt sich exakt mit der
  IWM-Spaltenüberschrift, die jede Beringerin aus der Meldedatei kennt.
  Verworfen: löst die Deklination nicht, und die vier bestehenden
  Doppelpunkt-Stellen müssten auf Krücken umgeschrieben werden.
- **Paarform überall, auch als Feldbeschriftung.** Am barrierefreiesten.
  Verworfen: „Beringerinnen und Beringer" über einem Ein-Personen-Autocomplete
  ist unbrauchbar lang, und Fehlermeldungen werden schwerfällig.
- **Doppelpunkt auch in Landing, AGB, Datenschutz und Wissen-Glossar.** Eine
  einzige Schreibweise im ganzen Produkt. Verworfen: bricht ~15 msgids samt
  EN-Übersetzung, fasst Rechtstexte ohne Anlass an, und verschlechtert das
  Glossar für seine erklärte Maschinenleser-Zielgruppe.
- **Auch die interne Sprache umstellen** — Glossarstichwort, 39 ADRs, `CLAUDE.md`,
  Code-Kommentare. Verworfen: hunderte Stellen ohne Nutzen für irgendeinen
  Benutzer, und ein Stichwort mit Doppelpunkt liest sich in Fließtext-Doku
  schlecht.
- **Alles so lassen.** Verworfen: das nackte generische Maskulinum war der Anlass,
  und `Wissenschaftler:innen` ist unabhängig davon ein Glossarverstoß.

## Consequences

- Ein Textdurchlauf durch Templates, Django-Meldungen und die zugehörigen Tests.
  Größenordnung: ~584 `Beringer`-Vorkommen in Frontend-Specs, Backend-Tests und
  e2e — davon trifft es den Teil, der auf sichtbaren Text prüft.
- Wer künftig „vereinheitlicht" und eine der vier Schreibweisen auf eine andere
  zieht, macht es falsch. Deshalb steht die Regel hier **und** als
  `_Oberfläche_`-Notiz am Glossareintrag **Beringer**.
- Modell `Scientist`, Endpunkt `/scientists/`, Formularfeld `staff` und das
  **Kürzel** bleiben unberührt — dieses ADR ändert Sprache, keine Struktur.
- Neue Oberflächentexte tragen ab sofort die Doppelpunktform. Neue öffentliche
  Prosa darf Paarform oder Doppelpunkt — nur nie das nackte Maskulinum.
