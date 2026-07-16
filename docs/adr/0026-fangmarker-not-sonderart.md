---
status: accepted
---

# Sonderfänge (Tot-Fund, Nicht-Standard-Fang) are Fangmarker on the capture, not Sonderarten

## Context

Beta-user feedback asks for two new special capture situations (user-feedback.md
#8, #9):

- **Tot-Fund** — a dead ringed bird (e.g. found under a net, or handed in by the
  public). "Tot-Fund" is written into the Bemerkung automatically and the
  Bemerkung becomes mandatory.
- **Nicht-Standard-Fang** — a bird caught *outside* the standard Fangprotokoll
  (hand catch, chance catch, demonstration bird). Its row is marked in the IWM
  export, the project-derived method columns are blanked, and the Bemerkung is
  mandatory with a hint.

Both were requested with a **button "dort wo Ring vernichtet ist"**, which makes
the obvious implementation look like a third and fourth **Sonderart**
(`special_kind` on `Species`, ADR 0004): "Ring Vernichtet" and "Aves ignota"
already work that way, and the button that applies them lives in the same action
row.

But a Sonderart **substitutes the Art**: you pick it *instead of* a real species.
A Tot-Fund is still a real, identified bird of a real Art on a real Ring (a dead
*Amsel* on ring V-1234 is an *Amsel*), and a Nicht-Standard-Fang is likewise a
fully-identified bird — just caught the wrong way. Substituting the species would
throw away the very data the record exists to hold. The two situations are also
**orthogonal**: a dead bird handed in outside the protocol is *both*, and either
can sit on an **Aves-ignota** bird (a dead, unlisted rarity). A single mutually-
exclusive discriminator cannot express that.

## Decision

Model **Tot-Fund** and **Nicht-Standard-Fang** as two **independent boolean
markers on `DataEntry`** — the domain concept **Fangmarker** — not as Sonderarten
on `Species`. The real Art and Ring are always kept.

- **Data model** — two nullable-free boolean fields on `DataEntry` (proposed
  `is_dead_recovery`, `is_non_standard`), alongside the existing capture flags
  (`has_mites`, …), serialized to the client so lists and the export read off
  them. Orthogonal: both may be true at once, and both may be true on an
  Aves-ignota capture. Hidden/forced-off only in **Ring vernichtet** mode (there
  is no bird to mark).
- **Trigger** — a toggle button for each marker in the form's `.action-buttons`
  row, next to "Ring vernichtet"; plain buttons, so they are **never in the Tab
  focus order** (`baseFocusOrder`). Both buttons are hidden while Ring vernichtet
  is active.
- **Mandatory Bemerkung** — reuses the Aves-ignota machinery (a `required`
  validator on the `comment` control + server-side `DataEntrySerializer.validate`).
  **Tot-Fund** opens a **popup asking for the Todesumstände** (required); on
  confirm it composes the Bemerkung to `Totfund; Umstände: <Eingabe>` (cancel =
  the marker is not applied; editing an existing Tot-Fund reopens the popup
  pre-filled by parsing that string). The Todesumstände is **not** a separate
  field — it lives only inside the composed Bemerkung, consistent with Tot-Fund
  reaching the export solely via the Bemerkung. **Nicht-Standard** adds a hint, no
  auto-text/popup.
- **Nicht-Standard visual + export** — the form gets a coloured frame + a badge
  ("Nicht-Standard-Fang"), reusing the `.edit-mode` outline pattern in a distinct
  colour; the IWM export **fills the row background** (openpyxl fill, purely
  visual for the user — the authority ignores formatting) and **blanks the three
  project-derived method columns** `Fangmethode`, `Lockmittel`, `Umstand`.
- **Tot-Fund visual + export** — **no** form frame/badge; the IWM export gets
  **no** row colour and keeps the method columns; Tot-Fund reaches the export only
  as the "Tot-Fund" text already in the Bemerkung column.
- **Both markers** — a distinct **row icon** in the "Letzte Fänge" list *and* the
  "Bisherige Fänge" (Wiederfang-Historie) table.
- **Statistics unchanged (for now)** — the markers do **not** alter the dashboard
  counts (Fänge, Individuenzahl, Artenzahl, Fangtag, Erstnachweis). A Tot-Fund
  therefore still counts as one Individuum for the moment. Revisiting this is a
  deliberate, separate decision (see Consequences).

## Considered options

- **New `special_kind` values on `Species` (the obvious path)** — rejected: a
  Sonderart substitutes the Art, destroying the real species/ring the record
  exists to hold, and cannot represent the orthogonal "dead **and**
  non-standard", or "dead Aves-ignota", combinations.
- **A single mutually-exclusive capture state (one enum)** — rejected: the two
  markers are orthogonal and must co-occur; an enum forbids the real combination.
- **Reuse the project-level Umstand code for non-standard** — rejected: Umstand is
  a Projekt property, constant across its captures (CONTEXT.md), so it cannot
  flag a single capture.

## Consequences

- Two new serialized booleans on the capture; the export and both list surfaces
  read off them. Adding a future marker is another boolean, no combinatorial
  states to forbid (the opposite trade-off to ADR 0004's discriminator, and
  correct *here* precisely because these markers are orthogonal, not exclusive).
- Because statistics are deliberately left unchanged, a Tot-Fund inflates
  Individuenzahl and a Nicht-Standard-Fang counts toward standard effort. When a
  user asks to exclude them, the CONTEXT.md definitions of Fänge / Individuenzahl
  / Artenzahl / Fangtag / Erstnachweis must be amended together, in a follow-up
  ADR.
- See the **Fangmarker**, **Tot-Fund** and **Nicht-Standard-Fang** entries in
  CONTEXT.md for the domain-language summary, and the **Sonderart** entry for why
  these are deliberately *not* Sonderarten.
