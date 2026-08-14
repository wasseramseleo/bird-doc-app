---
status: accepted
---

# Die Fehlerseiten stehen für sich — kein Chrome, Tuschegrund, und der Vogel sagt, welcher Zustand gilt

## Context

ADR 0037 hat den leeren und den kaputten Zustand getrennt und dafür zwei benannte
App-Icons eingeführt — `app-icon-error` und `app-icon-empty`, hinterlegt an genau
einer Stelle (`frontend/src/app/shared/app-icons.ts`), bewacht von
`scripts/check-icon-seam.mjs`. Bis die gezeichneten Vögel vorliegen, standen
Material-Ligaturen dahinter; „der Tausch ist eine Datei" war die Zusage. Der
`!`-Vogel ist jetzt da, der `?`-Vogel dazu, ungefragt.

Beim Nachsehen, wohin diese Vögel dürfen, kamen drei Dinge ans Licht:

- **Es gibt nirgends eine 404-Seite.** Die SPA leitet weiter
  (`app.routes.ts:82`, `{path:'**', redirectTo:''}`), die Landing hat weder
  `404.html` noch `handler404`, `TEMPLATES.DIRS` ist leer bei `APP_DIRS=True`,
  und der Caddyfile behandelt keine Fehler. Eine vertippte URL auf `birddoc.eu`
  bekommt heute Djangos graue Systemseite — auf einer Oberfläche, die sonst um
  jedes Detail ihrer Anmutung ringt.
- **Eine Fehlerseite darf `base.html` nicht unbesehen erben.** Die Basis führt
  `<link rel="canonical" href="{% canonical_url %}">` **außerhalb jedes Blocks**,
  und `django.template.context_processors.request` ist aktiv. Eine 404-Seite
  würde damit ein **selbstreferenzielles Canonical auf eine URL setzen, die 404
  antwortet** — sie also gegenüber Crawlern für legitim erklären. Auf einer
  Oberfläche mit eigenem Sitemap-, hreflang- und JSON-LD-Aufwand ist das ein
  echter Defekt.
- **Die 500-Seite hat gar keine Wahl.** Django rendert sie mit **leerem Kontext**;
  Kontextprozessoren laufen nicht. `{% canonical_url %}` würde `context["request"]`
  nicht finden und **im Fehlerbehandler selbst** brechen. Die 500 kann `base.html`
  nicht erben — sie bekommt weder Kopf- noch Fußzeile geschenkt.
- **Die SPA kann ohnehin keine echte 404 liefern.** `nginx.conf` macht
  `try_files $uri $uri/ /index.html`, jeder unbekannte Pfad antwortet also **200**
  mit der App-Hülle.

Die Zusammensetzung wurde nicht argumentiert, sondern **prototypisch angesehen**:
drei strukturell verschiedene Entwürfe (Karte mit Icon-Vogel · großer Vogel ohne
Karte · invertierte Tuschefläche), in der echten Landing mit echtem `landing.css`,
umschaltbar per `?variant=`.

## Decision

**Die Landing bekommt `404.html` und `500.html`; die SPA behält ihre
Weiterleitung.** Auf der Landing sind 404er echt: gecrawlt, verlinkt, von
Fremden über veraltete Links erreicht, mit echtem 404-Status. In der SPA ist ein
unbekannter Pfad fast nie ein Fremder, der tippt, sondern ein altes Lesezeichen
eines angemeldeten Mitglieds — auf dessen Dashboard zu landen ist nützlicher als
eine Sackgasse, und den wirklich veralteten Client hat ADR 0037 bereits als
Klasse *App aktualisieren* mit eigener Oberfläche. Die Weiterleitung bleibt eine
kleine Unwahrheit; sie wird bewusst behalten.

**Beide Fehlerseiten stehen für sich — ohne Kopfleiste, ohne Fußzeile.** Für die
500 ist das Zwang, für die 404 eine Entscheidung. Dass die beiden gleich
aussehen, ist der Punkt: sie sind derselbe Moment.

**Die Fläche kippt auf den Tuschegrund.** Vollflächig `--bd-ink`, darauf die
Musterfläche in ihrer **nativen weißen Farbe** — der einzige Ort im Produkt, an
dem sie keine Maske braucht. Darauf der Vogel in Papierfarbe, darunter Eyebrow,
Überschrift, ein Satz und **ein** Knopf. Keine Karte: das brass-gerandete
`.panel` ist das Idiom der **Feldkarte**, und eine Fehlerseite ist kein Formular,
das ausgefüllt werden will.

**Die Umkehrung gilt für die ganze Semantik, auch für das, was man nicht sieht.**
`.fehlerseite` bildet die Landing-Namen auf dem Tuschegrund neu ab, statt die
geerbten Bausteine einzeln umzufärben — und dazu gehört `--accent-tint`, aus dem
`.button:focus-visible` seinen Ring malt, nachdem es die Kontur des Browsers
abgeschaltet hat. Bleibt dieser eine Token beim Papiergrund-Wert, liegt der Ring
auf Tusche bei 1,16:1: der **einzige** Ausweg der Seite sähe fokussiert aus wie
unfokussiert. Ein Zustand, der nur in einem Zustand sichtbar ist, muss darum mit
dem Grund umgerechnet und nicht nur mit umgezogen werden — der Wert ist gemessen
(Papier zu 40 %: 3,35:1 gegen den Grund, 3,84:1 gegen das Knopfpapier, beide
Ränder über WCAG 1.4.11) und wird im Test aus dem Stylesheet nachgerechnet statt
als Literal festgenagelt.

**Die Seite nennt sich selbst.** Ohne Kopfleiste trüge sie sonst **keine
BirdDoc-Marke** — der `?`-Vogel ist nicht das Logo — und ein Fremder bekäme eine
dunkle Seite mit einem Knopf „Zurück zur Startseite" zu einer Seite, die er nicht
benennen kann. Also: Wortmarke oben (Zeichen 48 px, Lora 1,85 rem) und darunter
eine schmale Zeile Impressum · Datenschutz · AGB. Die Größe ist gewählt, nicht
geraten: eine Stufe größer konkurriert die Wortmarke mit dem Vogel darunter, und
die Seite liest sich als *zwei gestapelte Vögel*, bei denen das Auge das Motiv
nicht findet.

**`base.html` legt sein Canonical in einen Block.** Damit kann eine Seite, die
nicht kanonisch sein darf, es weglassen, statt es zu erben.

**Der `?`-Vogel übernimmt vorläufig auch `app-icon-empty`.** B1 („keine Fänge")
ist nicht geliefert. Ein handgezeichneter `!`-Vogel neben einer Material-Ligatur
— im Projekt-Dashboard sogar im **selben Slot** derselben Ansicht, nur im
anderen `@switch`-Zweig (`project-dashboard.html:93` und `:99`) — wäre der
sichtbarste Stilbruch, den dieser Umbau erzeugen kann. Der `?` überzieht dabei
leicht: auf dem Dashboard („In diesem Zeitraum gibt es noch keine Fänge") sitzt
er genau richtig, auf `stationen`/`beringer`/`artennormen` („Es sind noch keine
… angelegt") meint er *nicht gefunden*, wo *noch nicht angelegt* gilt. Das ist
die kleinere Sünde, und der Seam macht den späteren Tausch zu einer Datei — was
hiermit zum ersten Mal eingelöst wird.

**Die Vögel werden als Literal eingebettet, nicht geladen.** `addSvgIconLiteral`
statt `addSvgIcon(url)`: die `assets`-Gruppe in `ngsw-config.json` ist `lazy`,
eine Datei wird also erst nach ihrer ersten Anfrage zwischengespeichert. Der
Fehler-Vogel rendert womöglich **zum allerersten Mal offline in einer
Feldstation** — genau dem Moment, für den ADR 0037s Oberflächen existieren. Ein
Mechanismus, der ihn dann über HTTP holen will, zeigt ein leeres Kästchen, wenn
es am meisten zählt. Kosten: ~8 KB im Bundle. Die Marke bleibt demgegenüber ein
schlichtes `<img>` — sie steht überall auf Papier und braucht kein `currentColor`.

## Considered options

- **Drei benannte Icons statt zwei** — `app-icon-error`, `app-icon-nichts-gefunden`,
  `app-icon-empty` —, die fünf heutigen Aufrufstellen neu zugeordnet. Wohl das
  richtigere Modell und dieselbe Denkbewegung wie ADR 0037s sechs Fehlerklassen.
  Verworfen für jetzt: bei drei Namen und zwei Zeichnungen stünde hinter einem
  Namen wieder eine Material-Ligatur — genau das, was hier vermieden wird.
- **`app-icon-empty` bleibt `inbox`, bis B1 gezeichnet ist.** Semantisch
  ehrlicher. Verworfen: halb gezeichnet, halb Google, im selben Slot.
- **Auch die SPA bekommt eine 404-Route.** Verworfen: sie kann ohnehin nur eine
  weiche 404 sein (nginx antwortet 200), und sie fügt einen Bildschirm ohne
  Ausweg hinzu, den es nicht schon gäbe.
- **Karte behalten (Prototyp-Variante A).** Vertraut und im Idiom der übrigen
  Zielseiten. Verworfen: die Feldkarte verspricht ein Formular.
- **Großer Vogel auf Papier (Prototyp-Variante B).** Hielt der Vergrößerung
  besser stand als erwartet — die Zeichnung ist ein in sich geschlossenes Rondell,
  kein angeschnittenes Motiv. Verworfen zugunsten der Tuschefläche, die zusätzlich
  den einzigen maskenfreien Auftritt der Musterfläche ergibt.
- **Ganz ohne Wortmarke (Prototyp-Achse `chrome=nackt`).** Deutlich ruhiger.
  Verworfen: die 404 ist die Seite, auf der Fremde ankommen, und sie wäre die
  einzige Seite der Oberfläche ohne Weg zum Impressum — was für einen
  österreichischen Betreiber zumindest zu prüfen ist, statt es anzunehmen.
- **Wortmarke eine Stufe größer.** Verworfen: zwei gestapelte Vögel ähnlichen
  Gewichts.
- **`{% include %}` der Vogel-SVGs über `MatIconRegistry.addSvgIcon(url)`.**
  Verworfen: siehe Offline-Falle oben.

## Consequences

- **`birddoc.eu` antwortet auf Unbekanntes ab jetzt in der Marke** statt mit
  Djangos grauer Systemseite — ohne eine einzige URL-Zeile, weil `APP_DIRS`
  `landing/templates/404.html` von selbst findet.
- **Der Selbst-Canonical auf 404-URLs verschwindet**, weil `base.html` sein
  Canonical in einen Block legt. Das ist eine SEO-Korrektur, die ohne diesen
  Umbau niemand gesucht hätte.
- **Die 500-Seite hängt an nichts** — kein Kontextprozessor, keine Basisvorlage,
  eingebettetes SVG, `{% static %}` für das CSS. Genau so soll die Seite sein,
  die läuft, wenn anderes bricht. Wer die beiden später „vereinheitlicht", indem
  er beide `base.html` erben lässt, bricht die 500 und holt den
  Canonical-Defekt zurück; deshalb steht es hier.
- **`app-icons.ts` verliert seinen Vorbehalt.** Der Kommentar „bis die
  gezeichneten Vögel vorliegen, stehen Material-Icons dahinter" wird falsch und
  wird ersetzt.
- **`scripts/check-icon-seam.mjs` muss umgebaut werden.** Er liest die Tabelle
  `APP_ICON_BACKINGS` mit einem Regex, der kurze Ligaturzeichenketten erwartet;
  ein mehrzeiliges SVG-Literal darin bricht das Parsen. ADR 0037 hat den Tausch
  vorhergesehen, nicht aber seine Form: die SVG-Quellen werden eigene
  Konstanten, die Tabelle führt Namen. Das ist Arbeit, keine Umbenennung.
- **Fünf Bildschirme zeigen einen `?`, wo drei davon *noch nichts angelegt*
  meinen.** Bewusst und bis B1 eintrifft.
- **~8 KB Bundle** für die beiden eingebetteten Vögel.
- Die Prototypvarianten sind die Primärquelle dieser Entscheidung und liegen auf
  einem Wegwerf-Zweig; `main` trägt nur das Ergebnis.
