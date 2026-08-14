# Die Originale des Künstlers

Die Lieferung zu `docs/artist-brief.md`, unverändert verwahrt — §6 des Briefings
macht die Quelldateien zum Leistungsbestandteil, und ein Ordner, der nur
zufällig auf einer Platte liegt, ist keine Verwahrung (ADR 0043).

Der Lieferordner selbst (`birb/`) wird nie eingecheckt; hier liegen seine
Inhalte ohne `__MACOSX` und `.DS_Store`. **Dies sind Originale, keine
Betriebsmittel** — was die Oberfläche ausliefert, sind die Kanons in
`frontend/public/` und ihre Ableitungen aus `scripts/build-brand-assets.sh`.

## Was wozu wurde

| Original | Rolle | Kanon / Ableitung |
| --- | --- | --- |
| `SVG/birb_fluffyfat.svg` | A1 Master-Marke, **gewählte** Variante | `birddoc-marke.svg`, und beschnitten `birddoc-glyph.svg` |
| `SVG/birb_pattern.svg` | Musterfläche (ungefragt geliefert, tragend) | `birddoc-muster.svg` |
| `SVG/birb_error.svg` | B3, der `!`-Vogel | `app-icon-error` (Icon-Seam), 500-Seite |
| `SVG/birb_404.svg` | der `?`-Vogel (ungefragt geliefert) | `app-icon-empty` (vorläufig), 404-Seite |
| `SVG/birb_fluffy.svg` | A1-Variante, nicht gewählt | — (die Musterfläche zeichnet diesen Vogel) |
| `SVG/birb_original.svg` | A1-Variante, nicht gewählt | — |
| `SVG/birb_realistic.svg` | A1-Variante, nicht gewählt | — |

Die `PNG/`-Dateien sind die mitgelieferten Rasterfassungen derselben sieben
Zeichnungen. Sie sind ebenfalls Verwahrung: jede ausgelieferte PNG entsteht aus
dem SVG-Kanon über das Skript, nie aus diesen Dateien.

Die nicht gewählten Varianten bleiben liegen, damit eine spätere Markenanmeldung
oder Ableitung auf den ganzen Entwurfsraum zugreifen kann.

## Was fehlt

**A2** (vereinfachtes Glyph), **B1** (Empty-State) und **B2** (Erfolg) sind
nicht geliefert — Nachbestellung in #508. Die **nativen Quelldateien**
(AI/Affinity) sind nach §3 und §6 geschuldet und nicht geliefert — Vertragssache
in #509. Ohne sie ist das in §6 zugesicherte Bearbeitungsrecht nur über das SVG
ausübbar.
