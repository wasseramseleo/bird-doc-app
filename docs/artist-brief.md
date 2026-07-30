# BirdDoc — Briefing für den Illustrations-Auftrag

Auftraggeber: Alpine Coders e.U., Korneuburg (Dipl.-Ing. Leonard Guelmino)
Produkt: **BirdDoc** — Web-App zur Dokumentation wissenschaftlicher Vogelberingung (birddoc.app)
Stand: Juli 2026

## 1. Kontext und Ziel

Das aktuelle Logo — ein naiv handgezeichneter Vogel — ist ein KI-generierter
Platzhalter (Canva) und wird durch von Hand geschaffene Originale ersetzt.
Der Charakter der Marke soll dabei **erhalten bleiben**: warm, handgezeichnet,
unprätentiös — bewusst kein steriles Wissenschafts-Tool-Design.

Referenz für den Charakter: `frontend/public/web-app-manifest-512x512.png`
(liegt dem Briefing als Bild bei). Die Neuzeichnung ist eine **originalgetreue
Neuinterpretation** dieses Vogels — gleiche Anmutung, gleiche Pose-Idee,
aber als bewusst gesetzte, saubere Zeichnung statt KI-Artefakt.

## 2. Liefergegenstände

### A — Logo-System (3 Zeichnungen)

| # | Artefakt | Zweck | Vorgaben |
|---|----------|-------|----------|
| A1 | **Master-Marke** | Login-Seite, große Flächen, Print | Voller Detailgrad (Schraffur erlaubt), funktioniert ab ~64 px aufwärts |
| A2 | **Vereinfachtes Glyph** | Favicon, Navigationsleiste (28 px), kleine Flächen | Reduktion von A1: kräftigere Strichstärke, keine Innen-Schraffur, muss bei **16–32 px** klar lesbar bleiben |
| A3 | **App-Icon-Kachel** | PWA-/Home-Screen-Icon (Android „maskable") | A2-Glyph zentriert in der **inneren Safe-Zone (~80 % der Kantenlänge)** auf vollflächigem Hintergrund `#F7F2E8`; außerhalb der Safe-Zone darf nichts Wichtiges liegen, da das System kreisförmig beschneiden kann |

### B — Spot-Illustrationen (3 Zeichnungen, gleicher Stil und Strich wie A1)

| # | Artefakt | Einsatzort | Motiv-Vorschlag (Künstler:in frei) |
|---|----------|-----------|-------------------------------------|
| B1 | **Empty-State** | „Noch nichts hier"-Zustände (leere Projektliste u. Ä.) | Vogel betrachtet eine leere Sitzstange / ein leeres Blatt |
| B2 | **Erfolg/Bestätigung** | Bestätigungsseiten (Warteliste, Registrierung, E-Mail verifiziert) | Vogel fliegt beringt davon |
| B3 | **Offline/Fehler** | Offline- und Fehlerzustände (Feldstation ohne Netz) | Zerzauster Vogel im Regen |

## 3. Technische Vorgaben (alle Artefakte)

- **Echte Vektoren**: SVG **plus** natives Quellformat (AI, Affinity o. Ä.).
  Keine nachgezeichneten/vektorisierten Rasterbilder, keine eingebetteten
  Pixelbilder. Richtwert: ein sauberes Logo-SVG hat wenige KB.
- **Eine Tuschefarbe** („single ink"): flächige Ein-Farb-Linienzeichnung,
  keine Verläufe, keine Mehrton-Schattierung. Schraffur ist erlaubt
  (gleiche Farbe). Die Farbe wird softwareseitig über CSS gesteuert
  (`currentColor`) — bitte genau **eine** Füll-/Strichfarbe im SVG verwenden.
- **Transparenter Hintergrund** — Ausnahme A3 (vollflächig `#F7F2E8`).
- Keine größenspezifischen Export-Dateien nötig (PNG-Sets, ICO usw.
  erzeugen wir selbst aus den Vektoren).

## 4. Ausdrücklich NICHT Teil des Auftrags

- **Keine Wortmarke**: „BirdDoc" bleibt typografisch gesetzt (Lora).
- **Keine Export-Sets** (Favicons, App-Icons in allen Größen) — machen wir.
- **Keine Social-/OG-Bilder** — werden serverseitig aus dem echten Produkt
  gerendert (bewusste Design-Entscheidung).

## 5. Marken-Referenzwerte

Aus `brand-tokens.css` (kanonische Quelle der Markenebene):

- Papier/Hintergrund: `#F7F2E8` (Varianten `#FBF7EE`, `#EFE9DC`)
- Tusche: `#2B2A26` (soft `#6B655B`, faint `#A6A095`)
- Akzent (warmes Tusche-Braun, aus dem Logo abgeleitet): `#8B5A3C`
- Schrift: Lora (Display), Inter (Fließtext)

Die Zeichnungen müssen auf dem Papierton `#F7F2E8` funktionieren.

## 6. Nutzungsrechte (Vertragsbestandteil, schriftlich)

- **Ausschließliche, zeitlich, räumlich und sachlich unbeschränkte
  Werknutzungsrechte** (alle Medien, online und offline) an allen
  Liefergegenständen für Alpine Coders e.U.
- Ausdrücklich eingeschlossen: das **Bearbeitungsrecht** (Skalierung,
  Umfärbung, Ableitungen, Animation) und das Recht zur
  **Markenanmeldung** (Registrierung als Wort-Bild-/Bildmarke).
- Die Künstlerin / der Künstler behält das Recht, die Arbeiten im
  eigenen Portfolio zu zeigen.
- Übergabe der Quelldateien ist Teil der Leistung.

## 7. Prozessvorschlag

1. **Skizzenrunde**: Bleistift-/Grobskizzen für A1 und die drei Spots;
   Freigabe der Richtung.
2. **Reinzeichnung/Vektorisierung**: A1 → daraus Reduktion A2 → Kachel A3;
   danach die Spots.
3. **Kleinstgrößen-Check**: A2 gemeinsam bei 16 px und 32 px prüfen,
   bevor final geliefert wird.
