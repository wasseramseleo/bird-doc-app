"""Geometrie eines SVG, ohne es zu rendern (#511, ADR 0043).

Die Zusicherungen über die Marken-Kanons sind geometrisch: das Glyph ist ein
*Beschnitt* der Marke, die Musterfläche stößt in beiden Achsen ohne Schnittkante
an sich selbst. Beides ist eine Aussage über die **Tusche**, nicht über die
Datei — und beides braucht darum den Rahmen, den die Pfade tatsächlich füllen.

Gerendert wird dafür bewusst nichts. Ein Test, der ImageMagick oder einen
Browser anwirft, ist versionsabhängig und flatterig (so begründet in PRD #510);
die Rechnung hier ist reine Arithmetik auf den Pfaddaten und liefert bei
gleicher Datei immer dieselbe Zahl.

Der Umfang ist bewusst genau der der beiden Kanons: ``M``/``L``/``C``/``S``/``Z``
in beiden Schreibweisen, keine Transformationen, keine Striche, keine Bögen. Was
darüber hinausgeht, wirft — ein still falsch gerechneter Rahmen wäre schlimmer
als ein roter Test.

Gegenprobe: für ``docs/brand/SVG/birb_fluffyfat.svg`` liefert ``tusche_rahmen``
94.8872 / 58.4238 / 430.0880 / 462.0400 — auf vier Nachkommastellen dasselbe wie
``SVGGraphicsElement.getBBox()`` in Chromium.
"""

import math
import re

# Ein Befehlsbuchstabe oder eine Zahl (auch in Exponentialschreibweise).
_TOKEN = re.compile(r"[MmLlCcSsZz]|-?\d*\.?\d+(?:[eE]-?\d+)?")
# Wie viele Zahlen ein Befehl je Wiederholung verbraucht.
_ZAHLEN_JE_BEFEHL = {"M": 2, "L": 2, "C": 6, "S": 4}

_D_ATTRIBUT = re.compile(r'(?:^|\s)d="([^"]*)"')
_VIEWBOX_ATTRIBUT = re.compile(r'viewBox="([^"]*)"')


def pfaddaten(svg: str) -> list[str]:
    """Die ``d``-Attribute aller Pfade in Dokumentreihenfolge."""
    return _D_ATTRIBUT.findall(svg)


def artboard(svg: str) -> tuple[float, float, float, float]:
    """Die ``viewBox`` als ``(links, oben, rechts, unten)``."""
    treffer = _VIEWBOX_ATTRIBUT.search(svg)
    if treffer is None:
        raise ValueError("SVG ohne viewBox")
    x, y, breite, hoehe = (float(teil) for teil in treffer.group(1).replace(",", " ").split())
    return (x, y, x + breite, y + hoehe)


def tusche_rahmen(svg: str) -> tuple[float, float, float, float]:
    """Der Rahmen, den die Tusche wirklich füllt, als ``(links, oben, rechts, unten)``."""
    punkte: list[tuple[float, float]] = []
    for daten in pfaddaten(svg):
        punkte.extend(_punkte_eines_pfades(daten))
    if not punkte:
        raise ValueError("SVG ohne Pfaddaten")
    xs = [p[0] for p in punkte]
    ys = [p[1] for p in punkte]
    return (min(xs), min(ys), max(xs), max(ys))


def _punkte_eines_pfades(daten: str) -> list[tuple[float, float]]:
    """Alle Punkte, die den Rahmen eines Pfades bestimmen.

    Für Kurven sind das die beiden Endpunkte plus die Extrema — nicht die
    Kontrollpunkte, die weit außerhalb der Tusche liegen können.
    """
    tokens = _TOKEN.findall(daten)
    punkte: list[tuple[float, float]] = []
    stelle = 0
    hier = (0.0, 0.0)
    beginn = (0.0, 0.0)
    letzter_kontrollpunkt: tuple[float, float] | None = None
    befehl: str | None = None

    while stelle < len(tokens):
        token = tokens[stelle]
        if token.isalpha():
            befehl = token
            stelle += 1
            if befehl in "Zz":
                hier = beginn
                letzter_kontrollpunkt = None
                befehl = None
                continue
        if befehl is None:
            raise ValueError(f"Pfaddaten ohne Befehl: {daten[:40]!r}")
        art = befehl.upper()
        if art not in _ZAHLEN_JE_BEFEHL:
            raise ValueError(f"nicht unterstützter Pfadbefehl {befehl!r}")
        anzahl = _ZAHLEN_JE_BEFEHL[art]
        zahlen = [float(t) for t in tokens[stelle : stelle + anzahl]]
        if len(zahlen) != anzahl:
            raise ValueError(f"abgeschnittene Pfaddaten bei {befehl!r}")
        stelle += anzahl
        ursprung = hier if befehl.islower() else (0.0, 0.0)
        stellen = [
            (ursprung[0] + zahlen[i], ursprung[1] + zahlen[i + 1]) for i in range(0, anzahl, 2)
        ]

        if art in ("M", "L"):
            punkte.append(stellen[0])
            hier = stellen[0]
            letzter_kontrollpunkt = None
            if art == "M":
                beginn = stellen[0]
                # Weitere Zahlenpaare nach einem moveto sind linetos.
                befehl = "l" if befehl.islower() else "L"
        else:
            if art == "C":
                k1, k2, ende = stellen
            else:  # "S" — der erste Kontrollpunkt ist die Spiegelung des vorigen.
                k2, ende = stellen
                k1 = (
                    hier
                    if letzter_kontrollpunkt is None
                    else (
                        2 * hier[0] - letzter_kontrollpunkt[0],
                        2 * hier[1] - letzter_kontrollpunkt[1],
                    )
                )
            punkte.append(hier)
            punkte.append(ende)
            for t in _extrema(hier, k1, k2, ende):
                punkte.append(_kurvenpunkt(hier, k1, k2, ende, t))
            letzter_kontrollpunkt = k2
            hier = ende

    return punkte


def _extrema(p0, p1, p2, p3) -> list[float]:
    """Die ``t`` in (0, 1), an denen eine Komponente der Kubik umkehrt."""
    werte: list[float] = []
    for a, b, c, d in ((p0[0], p1[0], p2[0], p3[0]), (p0[1], p1[1], p2[1], p3[1])):
        # Ableitung der Kubik, als Quadratische A·t² + B·t + C.
        A = -a + 3 * b - 3 * c + d
        B = 2 * (a - 2 * b + c)
        C = -a + b
        if abs(A) < 1e-12:
            if abs(B) > 1e-12 and 0 < -C / B < 1:
                werte.append(-C / B)
            continue
        diskriminante = B * B - 4 * A * C
        if diskriminante < 0:
            continue
        wurzel = math.sqrt(diskriminante)
        for t in ((-B + wurzel) / (2 * A), (-B - wurzel) / (2 * A)):
            if 0 < t < 1:
                werte.append(t)
    return werte


def _kurvenpunkt(p0, p1, p2, p3, t: float) -> tuple[float, float]:
    g = 1 - t
    return (
        g**3 * p0[0] + 3 * g * g * t * p1[0] + 3 * g * t * t * p2[0] + t**3 * p3[0],
        g**3 * p0[1] + 3 * g * g * t * p1[1] + 3 * g * t * t * p2[1] + t**3 * p3[1],
    )
