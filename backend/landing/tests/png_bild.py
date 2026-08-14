"""Eine PNG lesen, ohne Bildbibliothek (#512, ADR 0043).

Die Rasterableitungen der Marke entstehen aus ``scripts/build-brand-assets.sh``
und werden eingecheckt. Geprüft wird das **Ergebnis**, nicht der Weg dorthin:
ImageMagick in der CI laufen zu lassen ist langsam und versionsabhängig, und ein
Vergleich gegen eine Neuerzeugung wäre flatterig (so begründet in PRD #510).

Darum liest dieses Modul die eingecheckten Dateien selbst — mit ``zlib`` aus der
Standardbibliothek, ohne Pillow und ohne Neuerzeugung:

* ``masse`` und ``hat_alphakanal`` lesen **nur den Kopf** (den ``IHDR``-Block,
  13 Byte hinter der Signatur). Das ist die Zusicherung über die Maße.
* ``ecken`` und ``tuscheabstand`` entfaltern die Bildzeilen. Sie beantworten die
  beiden Fragen, die eine Kachel zur *maskierbaren* Kachel machen: liegt
  vollflächiger Grund bis in die Ecken, und bleibt die Zeichnung im Safe-Kreis.

Der Umfang ist bewusst genau der der Ableitungen: Farbtyp 2 (Echtfarbe, kein
Alpha), 8 Bit, nicht verschränkt. Alles andere wirft — ein still falsch
gerechneter Befund wäre schlimmer als ein roter Test.
"""

import zlib
from dataclasses import dataclass
from math import hypot
from pathlib import Path

SIGNATUR = b"\x89PNG\r\n\x1a\n"

# Farbtypen des PNG-Kopfes, die einen Alphakanal führen: 4 = Grau+Alpha,
# 6 = Echtfarbe+Alpha. Farbtyp 3 (Palette) kann über einen `tRNS`-Block
# ebenfalls durchsichtig werden, darum wird der zusätzlich gesucht.
FARBTYPEN_MIT_ALPHA = frozenset({4, 6})

Farbe = tuple[int, int, int]


@dataclass(frozen=True)
class Kopf:
    """Der ``IHDR``-Block: was die Datei über sich selbst sagt."""

    breite: int
    hoehe: int
    bittiefe: int
    farbtyp: int
    verschraenkt: bool


def kopf(pfad: Path) -> Kopf:
    """Der Kopf der PNG — gelesen, nicht gerendert."""
    daten = pfad.read_bytes()
    if not daten.startswith(SIGNATUR):
        raise ValueError(f"{pfad.name} ist keine PNG")
    art, inhalt = next(_bloecke(daten))
    if art != b"IHDR" or len(inhalt) != 13:
        raise ValueError(f"{pfad.name} beginnt nicht mit einem IHDR-Block")
    return Kopf(
        breite=int.from_bytes(inhalt[0:4], "big"),
        hoehe=int.from_bytes(inhalt[4:8], "big"),
        bittiefe=inhalt[8],
        farbtyp=inhalt[9],
        verschraenkt=bool(inhalt[12]),
    )


def masse(pfad: Path) -> tuple[int, int]:
    """Breite und Höhe in Bildpunkten, aus dem Kopf."""
    gelesen = kopf(pfad)
    return (gelesen.breite, gelesen.hoehe)


def hat_alphakanal(pfad: Path) -> bool:
    """Ob die PNG durchsichtig sein kann — Farbtyp mit Alpha oder ``tRNS``."""
    if kopf(pfad).farbtyp in FARBTYPEN_MIT_ALPHA:
        return True
    return any(art == b"tRNS" for art, _ in _bloecke(pfad.read_bytes()))


def ecken(pfad: Path) -> tuple[Farbe, Farbe, Farbe, Farbe]:
    """Die vier Eckpunkte, im Uhrzeigersinn ab links oben."""
    zeilen = _bildzeilen(pfad)
    breite = len(zeilen[0]) // 3
    return (
        _bildpunkt(zeilen[0], 0),
        _bildpunkt(zeilen[0], breite - 1),
        _bildpunkt(zeilen[-1], breite - 1),
        _bildpunkt(zeilen[-1], 0),
    )


def tuscheabstand(pfad: Path, grund: Farbe) -> float:
    """Wie weit die Zeichnung von der Bildmitte reicht, in Bildpunkten.

    „Zeichnung" ist hier jeder Bildpunkt, der vom Grund abweicht — auch ein nur
    angerauter Kantenpunkt zählt mit. Das ist die vorsichtige Richtung: was hier
    als Tusche gilt, darf im Safe-Kreis nicht fehlen.
    """
    zeilen = _bildzeilen(pfad)
    breite = len(zeilen[0]) // 3
    grundzeile = bytes(grund) * breite
    mitte_x = (breite - 1) / 2
    mitte_y = (len(zeilen) - 1) / 2

    abstand = None
    for y, zeile in enumerate(zeilen):
        rand = _abweichende_raender(zeile, grundzeile)
        if rand is None:
            continue
        erster, letzter = rand
        weiteste = max(abs(erster - mitte_x), abs(letzter - mitte_x))
        hier = hypot(weiteste, y - mitte_y)
        if abstand is None or hier > abstand:
            abstand = hier
    if abstand is None:
        raise ValueError(f"{pfad.name} trägt keinen einzigen Bildpunkt neben dem Grund")
    return abstand


def _bloecke(daten: bytes):
    """Die Blöcke der Datei als ``(Art, Inhalt)`` — Länge, Art, Inhalt, Prüfsumme."""
    stelle = len(SIGNATUR)
    while stelle + 8 <= len(daten):
        laenge = int.from_bytes(daten[stelle : stelle + 4], "big")
        art = daten[stelle + 4 : stelle + 8]
        yield art, daten[stelle + 8 : stelle + 8 + laenge]
        stelle += laenge + 12


def _bildpunkt(zeile: bytes, x: int) -> Farbe:
    return (zeile[3 * x], zeile[3 * x + 1], zeile[3 * x + 2])


def _abweichende_raender(zeile: bytes, grundzeile: bytes) -> tuple[int, int] | None:
    """Der erste und der letzte Bildpunkt einer Zeile, der vom Grund abweicht.

    Gerechnet auf der ganzen Zeile statt Punkt für Punkt: die beiden Zeilen als
    eine große Zahl exklusiv-oder-verknüpft, dann sagt das höchste gesetzte Bit,
    wo links die erste Abweichung steht, und das niedrigste, wo rechts die
    letzte steht.
    """
    unterschied = int.from_bytes(zeile, "big") ^ int.from_bytes(grundzeile, "big")
    if unterschied == 0:
        return None
    laenge = len(zeile)
    erstes_byte = laenge - 1 - (unterschied.bit_length() - 1) // 8
    letztes_bit = (unterschied & -unterschied).bit_length()
    letztes_byte = laenge - 1 - (letztes_bit - 1) // 8
    return (erstes_byte // 3, letztes_byte // 3)


def _bildzeilen(pfad: Path) -> list[bytes]:
    """Die entfilterten Bildzeilen, je Zeile ``breite × 3`` Byte (R, G, B)."""
    gelesen = kopf(pfad)
    if (gelesen.farbtyp, gelesen.bittiefe, gelesen.verschraenkt) != (2, 8, False):
        raise ValueError(
            f"{pfad.name}: nur Farbtyp 2 mit 8 Bit und ohne Verschränkung wird gelesen, "
            f"gefunden Farbtyp {gelesen.farbtyp}, {gelesen.bittiefe} Bit, "
            f"verschränkt={gelesen.verschraenkt}"
        )
    daten = pfad.read_bytes()
    roh = zlib.decompress(b"".join(inhalt for art, inhalt in _bloecke(daten) if art == b"IDAT"))

    schrittweite = gelesen.breite * 3
    zeilen: list[bytes] = []
    vorherige = bytes(schrittweite)
    stelle = 0
    for _ in range(gelesen.hoehe):
        art = roh[stelle]
        zeile = bytearray(roh[stelle + 1 : stelle + 1 + schrittweite])
        stelle += 1 + schrittweite
        _entfiltern(art, zeile, vorherige)
        vorherige = bytes(zeile)
        zeilen.append(vorherige)
    return zeilen


def _entfiltern(art: int, zeile: bytearray, vorherige: bytes) -> None:
    """Den Zeilenfilter zurückrechnen (PNG-Norm, Abschnitt 9.2); ``bpp`` ist 3."""
    bpp = 3
    if art == 0:  # None
        return
    if art == 1:  # Sub
        for i in range(bpp, len(zeile)):
            zeile[i] = (zeile[i] + zeile[i - bpp]) & 0xFF
    elif art == 2:  # Up
        for i in range(len(zeile)):
            zeile[i] = (zeile[i] + vorherige[i]) & 0xFF
    elif art == 3:  # Average
        for i in range(len(zeile)):
            links = zeile[i - bpp] if i >= bpp else 0
            zeile[i] = (zeile[i] + ((links + vorherige[i]) >> 1)) & 0xFF
    elif art == 4:  # Paeth
        for i in range(len(zeile)):
            links = zeile[i - bpp] if i >= bpp else 0
            oben = vorherige[i]
            schraeg = vorherige[i - bpp] if i >= bpp else 0
            schaetzung = links + oben - schraeg
            nach_links = abs(schaetzung - links)
            nach_oben = abs(schaetzung - oben)
            nach_schraeg = abs(schaetzung - schraeg)
            if nach_links <= nach_oben and nach_links <= nach_schraeg:
                vorlage = links
            elif nach_oben <= nach_schraeg:
                vorlage = oben
            else:
                vorlage = schraeg
            zeile[i] = (zeile[i] + vorlage) & 0xFF
    else:
        raise ValueError(f"unbekannter Zeilenfilter {art}")
