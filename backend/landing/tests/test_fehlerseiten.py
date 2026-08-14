"""Die beiden Fehlerseiten der Landing (issue #515, ADR 0044).

Zwei Einstiege, beide so hoch wie möglich:

* **Die 404 über HTTP** — mit dem Django-Testclient auf eine erfundene Adresse.
  Das geht, weil die Testeinstellungen ``DEBUG`` auf ``False`` lassen, Django
  also seinen echten 404-Behandler nimmt statt der Debug-Seite.
* **Die 500 durch direktes Rendern mit leerem Kontext** — bewusst *nicht* über
  den Client. Die zu sichernde Eigenschaft *ist* „übersteht einen leeren
  Kontext"; ein über den Client ausgelöster 500er würde auch dann grün, wenn die
  Vorlage vom Request abhinge, weil der Client einen mitliefert.
"""

import re
from pathlib import Path

import pytest

# backend/landing/tests/test_fehlerseiten.py → das Wurzelverzeichnis ist vier
# Ebenen höher (dieselbe Rechnung wie in test_brand_parity.py).
REPO_ROOT = Path(__file__).resolve().parents[3]

ERFUNDENE_ADRESSE = "/diese-adresse-gibt-es-nicht/"


def rendere_die_500_mit_leerem_kontext():
    """Genau der Weg, den ``django.views.defaults.server_error`` geht.

    Kein Request, keine Kontextprozessoren — die Vorlage bekommt nichts. Über
    den Testclient wäre dieselbe Zusicherung wertlos: der Client liefert einen
    Request mit, also würde sie auch dann grün, wenn die Vorlage von ihm abhinge.
    """
    from django.template.loader import get_template

    return get_template("500.html").render()


@pytest.fixture(params=["404", "500"])
def fehlerseite(request, client):
    """Beide Fehlerseiten, jede über ihren eigenen Einstieg.

    Dass die Zusicherungen darunter über *beide* laufen, ist der Punkt: die
    zwei Seiten sollen derselbe Moment sein (ADR 0044), und sie stehen ohne
    gemeinsame Basisvorlage nebeneinander — nichts außer diesem Parameter hält
    sie davon ab, auseinanderzulaufen.
    """
    if request.param == "404":
        return client.get(ERFUNDENE_ADRESSE).content.decode()
    return rendere_die_500_mit_leerem_kontext()


def test_eine_erfundene_adresse_antwortet_mit_404_und_der_gezeichneten_seite(client):
    # Kein `handler404`, keine URL-Zeile: `APP_DIRS=True` findet
    # `landing/templates/404.html` von selbst (ADR 0044).
    antwort = client.get(ERFUNDENE_ADRESSE)
    assert antwort.status_code == 404
    inhalt = antwort.content.decode()
    # Nicht Djangos graue Systemseite, sondern die Marke: die Seite nennt sich
    # selbst, weil sie ohne Kopfleiste steht.
    assert "BirdDoc" in inhalt
    assert "Diese Seite gibt es nicht" in inhalt


def test_die_404_erklaert_sich_crawlern_nicht_selbst_fuer_legitim(client):
    # Die eigentliche Regressionssicherung aus ADR 0044: `base.html` führt sein
    # `<link rel="canonical">` seit #515 in einem Block, damit eine Seite, die
    # nicht kanonisch sein darf, es weglassen kann statt es zu erben. Eine
    # 404-Adresse, die sich selbst kanonisiert, meldet Crawlern eine tote
    # Adresse als legitim.
    inhalt = client.get(ERFUNDENE_ADRESSE).content.decode()
    assert 'rel="canonical"' not in inhalt


def test_die_basisvorlage_laesst_ihr_canonical_abwaehlen(rf):
    # Die Eigenschaft, nicht die Zeile: eine erbende Seite, die nicht kanonisch
    # sein darf, kann das Canonical der Basis weglassen — vorher stand es
    # außerhalb jedes Blocks und war unabwählbar. Die übrigen Seiten tragen ihr
    # Canonical unverändert weiter (test_seo.py).
    from django.template import engines

    request = rf.get("/")
    django_engine = engines["django"]

    geerbt = django_engine.from_string('{% extends "landing/base.html" %}').render(request=request)
    assert 'rel="canonical"' in geerbt

    abgewaehlt = django_engine.from_string(
        '{% extends "landing/base.html" %}{% block canonical %}{% endblock %}'
    ).render(request=request)
    assert 'rel="canonical"' not in abgewaehlt


def test_die_500_rendert_mit_leerem_kontext_ohne_ausnahme():
    # Die zu sichernde Eigenschaft der 500 *ist* „übersteht einen leeren
    # Kontext": Django rendert sie im Fehlerbehandler ohne Request, also darf
    # sie weder `base.html` erben noch einen Kontextprozessor brauchen. Bräche
    # sie hier, bräche der Fehlerbehandler selbst.
    inhalt = rendere_die_500_mit_leerem_kontext()
    assert "BirdDoc" in inhalt
    assert "Da ist uns etwas abgestürzt" in inhalt


def test_die_500_sagt_dass_der_fehler_bei_uns_liegt_und_nicht_beim_lesenden():
    # Wer während einer Störung liest, soll nicht anfangen, den Fehler bei sich
    # zu suchen.
    inhalt = rendere_die_500_mit_leerem_kontext()
    assert "bei uns" in inhalt
    assert "nicht bei dir" in inhalt


def test_beide_fehlerseiten_verbieten_sich_die_indexierung(fehlerseite):
    assert '<meta name="robots" content="noindex">' in fehlerseite


def test_keine_fehlerseite_leckt_ein_rohes_vorlagen_kommentar(fehlerseite):
    # Vorbild: die bestehende Zusicherung in test_brand_layer.py. Ein
    # mehrzeiliges {# … #} ist KEIN Django-Kommentar und rendert wörtlich —
    # und beide Fehlerseiten tragen lange Erklärkommentare.
    assert "{#" not in fehlerseite
    assert "#}" not in fehlerseite


def test_beide_fehlerseiten_stehen_ohne_kopfleiste_fuss_und_karte(fehlerseite):
    # Sie erben nichts: keine Kopfleiste, keine Fußzeile. Und keine Karte — das
    # brass-gerandete `.panel` ist das Idiom der Feldkarte, und eine Fehlerseite
    # ist kein Formular, das ausgefüllt werden will (ADR 0044).
    assert "site-header" not in fehlerseite
    assert "site-footer" not in fehlerseite
    assert "panel" not in fehlerseite


def test_beide_fehlerseiten_tragen_dieselbe_zusammensetzung(fehlerseite):
    # Von oben nach unten: Wortmarke, Vogel, Eyebrow, Überschrift, EIN Satz,
    # GENAU EIN Knopf, zuletzt die Rechts-Zeile.
    assert fehlerseite.count("fehlerseite__wortmarke") == 1
    assert "BirdDoc" in fehlerseite
    assert fehlerseite.count("fehlerseite__vogel") == 1
    assert fehlerseite.count("fehlerseite__eyebrow") == 1
    assert fehlerseite.count("<h1") == 1
    assert fehlerseite.count("fehlerseite__satz") == 1
    # Genau ein Ausweg: wer hier landet, soll nicht überlegen müssen, was als
    # Nächstes zu tun ist.
    assert fehlerseite.count('class="button"') == 1
    for rechtsseite in ("Impressum", "Datenschutz", "AGB"):
        assert rechtsseite in fehlerseite


def test_musterflaeche_und_vogel_sind_als_schmueckend_ausgezeichnet(fehlerseite):
    # Schmuck wird nicht vorgelesen: die Musterfläche, der Vogel und das
    # Zeichen der Wortmarke (dessen Wort daneben steht) sind aria-hidden.
    for klasse in ("fehlerseite__muster", "fehlerseite__vogel", "fehlerseite__zeichen"):
        treffer = re.search(rf'<(?:div|span) class="{klasse}"([^>]*)>', fehlerseite)
        assert treffer, f"{klasse} fehlt auf der Seite"
        assert 'aria-hidden="true"' in treffer.group(1), f"{klasse} wird vorgelesen"


def test_wortmarke_und_rechts_links_sind_mit_der_tastatur_ansteuerbar(fehlerseite):
    # Echte Anker mit Ziel sind nativ fokussierbar; nichts nimmt sie mit
    # `tabindex="-1"` aus der Tabreihenfolge.
    assert re.search(r'<a class="fehlerseite__wortmarke" href="[^"]+"', fehlerseite)
    rechts = re.search(r'<nav class="fehlerseite__recht".*?</nav>', fehlerseite, re.S)
    assert rechts, "die Rechts-Zeile fehlt"
    assert len(re.findall(r'<a href="[^"]+"', rechts.group(0))) == 3
    assert 'tabindex="-1"' not in fehlerseite


def test_die_500_vorlage_sagt_im_quelltext_warum_sie_nichts_erbt():
    # Damit sie niemand „vereinheitlicht": die Begründung steht in der Datei,
    # nicht nur im ADR — und als echter `comment`-Block, damit sie den Lesenden
    # nicht erreicht (siehe die Zusicherung gegen `{#` oben).
    quelle = (REPO_ROOT / "backend" / "landing" / "templates" / "500.html").read_text()
    assert "{% comment %}" in quelle
    assert "base.html" in quelle
    assert "LEEREM KONTEXT" in quelle


def lies_regel(css, selektor):
    treffer = re.search(rf"^{re.escape(selektor)} \{{(.*?)^\}}", css, re.S | re.M)
    assert treffer, f"CSS-Regel {selektor} fehlt"
    return treffer.group(1)


def hat_deklaration(regel, eigenschaft, wert):
    """Ob die Regel GENAU diese Deklaration führt.

    Bewusst zeilengenau statt als Teilzeichenkette: `var(--bd-ink)` steht in
    dieser Regel auch in den `color-mix`-Ableitungen, und `mask-image: …` ist
    seinerseits Teil von `-webkit-mask-image: …`. Eine Teilzeichenkette bliebe
    also grün, während die eigentliche Deklaration schon umgeschrieben wäre —
    genau das ist beim Mutationstest passiert.
    """
    muster = rf"^\s*{re.escape(eigenschaft)}:\s*{re.escape(wert)};\s*$"
    return re.search(muster, regel, re.M) is not None


def test_die_fehlerflaeche_kippt_vollflaechig_auf_den_tuschegrund():
    css = (REPO_ROOT / "backend" / "landing" / "static" / "landing" / "landing.css").read_text()
    regel = lies_regel(css, ".fehlerseite")
    assert hat_deklaration(regel, "background-color", "var(--bd-ink)")
    assert hat_deklaration(regel, "min-height", "100vh")


def test_die_musterflaeche_der_fehlerseiten_braucht_keine_maske():
    # Der einzige Ort im Produkt, an dem die Musterfläche in ihrer NATIVEN
    # weißen Farbe läuft (ADR 0043/0044) — auf Tusche färbt sie sich selbst.
    # Fehlt das Hintergrundbild, bleibt der Tuschegrund: Schmuck fällt still
    # aus, statt zum Defekt zu werden.
    css = (REPO_ROOT / "backend" / "landing" / "static" / "landing" / "landing.css").read_text()
    regel = lies_regel(css, ".fehlerseite__muster")
    assert hat_deklaration(regel, "background-image", 'url("./birddoc-muster.svg")')
    assert "mask-image" not in regel
    # Kachel und Deckkraft bleiben die geteilten Knöpfe aus brand-tokens.css,
    # damit „niedriger Kontrast" ein prüfbarer Wert bleibt.
    assert hat_deklaration(regel, "background-size", "var(--bd-muster-kachel) auto")
    assert hat_deklaration(regel, "opacity", "var(--bd-muster-deckkraft)")


def test_das_zeichen_der_wortmarke_kommt_aus_dem_bewachten_kanon():
    # Auf Tuschegrund wäre die Marke als <img> unsichtbar (sie ist schwarze
    # Tusche auf Transparenz). Sie wird darum über `mask-image` eingefärbt —
    # und bleibt so die EINE bewachte Kanon-Datei, statt als vierte Kopie der
    # Zeichnung in die Vorlagen zu wandern und dort unbemerkt zu veralten.
    css = (REPO_ROOT / "backend" / "landing" / "static" / "landing" / "landing.css").read_text()
    regel = lies_regel(css, ".fehlerseite__zeichen")
    # Beide Schreibweisen — Safari braucht die Präfixform, alle anderen die
    # ungepräfixte; zeigte nur eine auf den Kanon, hinge die halbe Welt an einer
    # Kopie.
    for eigenschaft in ("-webkit-mask-image", "mask-image"):
        assert hat_deklaration(regel, eigenschaft, 'url("./birddoc-marke.svg")'), eigenschaft
    assert hat_deklaration(regel, "background-color", "currentColor")


def test_die_spa_leitet_unbekannte_pfade_unveraendert_weiter():
    # ADR 0044 behält die Weiterleitung bewusst: die SPA könnte ohnehin keinen
    # echten 404-Status liefern (der Webserver antwortet auf jeden unbekannten
    # Pfad mit 200 und der App-Hülle), und ein altes Lesezeichen eines
    # angemeldeten Mitglieds ist auf seinem Dashboard besser aufgehoben als in
    # einer Sackgasse. Die Fehlerseiten der Landing ändern daran nichts.
    routen = (REPO_ROOT / "frontend" / "src" / "app" / "app.routes.ts").read_text()
    assert re.search(r"path:\s*'\*\*'\s*,\s*redirectTo:\s*''", routen)
