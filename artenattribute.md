# Feature Artenattribute — Plausibilitätsprüfung (resolved design)

The 20-year-old ringing software attaches per-species "Plausibilität" metadata so a
*syntactically* valid measurement that is biologically out of range is flagged as a
probable **Messfehler** (see `docs/Artenattribute-example.jpeg`). birddoc reproduces
this as the **Artennorm** (per-species expected values) driving a soft, non-blocking
**Plausibilitätswarnung** at data entry.

Grilled and resolved on 2026-07-03. Glossary: `CONTEXT.md` (**Artennorm**,
**Plausibilitätswarnung**; refs Diesjährig, Unbekannte Art/Aves ignota, Organisation,
Empfohlene Ringgröße). Decision record: **ADR 0021** (two-layer ownership, in the
spirit of ADR 0019). Source data: `docs/Korrekturebenen.xlsx`.

## 1. What an Artennorm checks

Seven numeric Ausreißertests plus two categorical flags — all keyed by **species only**
(no sex/age/size split, matching the seed data and the old software), all **independently
optional** (a rule fires only where its norm is set):

| Rule | `DataEntry` field | Band |
|---|---|---|
| Gewicht | `weight_gram` | Ø ± k·SD |
| Federlänge | `feather_span` | Ø ± k·SD |
| Flügellänge | `wing_span` | Ø ± k·SD |
| Tarsus | `tarsus` | Ø ± k·SD |
| Kerbe F2 | `notch_f2` | Ø ± k·SD |
| Innenfuß | `inner_foot` | Ø ± k·SD |
| Quotient Federl./Flügell. | `feather_span / wing_span` (derived) | Ø ± Toleranz-% |
| Geschlechtsbestimmung möglich | `sex` | flag |
| bei dj. Großgefiedermauser möglich | `age_class` + `hand_wing` | flag |

- **k = `sd_factor`**, one per Artennorm row, default **1.96** (the xlsx's "±SD"; the
  "95 %" column is its human read-out, not stored separately).
- A numeric check fires only when the field has a value **and** the norm's Ø/SD are set.
- The **Quotient** is derived (no stored field) and uses a *relative* band
  (`quotient_mean ± quotient_tolerance_pct`, default 3 %); fires only when both
  `feather_span` and `wing_span` are present.
- **Geschlechtsbestimmung möglich = false** and a *determined* sex (Männchen/Weibchen) →
  warn; Unbekannt never warns.
- **bei dj. Großgefiedermauser möglich = false** and the bird is **diesjährig** (age
  class 3) and carries a Handschwingenmauser value → warn.

## 2. Two-layer ownership (ADR 0021)

`Species` is global reference data (never tenant-scoped), yet norms must (a) work out of
the box for every org and (b) be tunable by an org Admin. So:

- A **globale Standard-Artennorm** ships with the app (seeded, `organization = NULL`),
  shared like `Species`/`Central`.
- An Organisation's Admin may **override** it per species.
- **Effective norm = the org override if one exists, else the global default**
  (replace-whole-row — a single lookup, never a per-column merge). Clearing a field in an
  override switches *that* check off for the org. Norms are never shared-and-mutated
  across tenants.

## 3. Data model

New wide table `SpeciesNorm` (domain: **Artennorm**):

- `species` FK; `organization` FK **nullable** (NULL = global default).
- Partial-unique `(species)` where `organization IS NULL`; unique `(species, organization)`.
- `weight_mean/_sd`, `feather_mean/_sd`, `wing_mean/_sd`, `tarsus_mean/_sd`,
  `notch_f2_mean/_sd`, `inner_foot_mean/_sd`, `quotient_mean`, `quotient_tolerance_pct`,
  `sd_factor` (default 1.96), `geschlechtsbestimmung_moeglich`,
  `dj_grossgefiedermauser_moeglich`. **All nullable** (null = that rule is off).

## 4. Plausibilitätswarnung UX

- **Inline** under the field, non-modal, on **blur** (Tab/Enter flow makes blur fire
  exactly when a value is finished) — the sex-contradiction `role="alert"` idiom, not the
  ring-size ConfirmDialog.
- **Save-time acknowledgment**: hitting Speichern with any active Warnung shows one
  aggregated Bestätigung listing the discrepancies; the Beringer confirms once, then the
  entry is written or queued offline. **Not stored** on the capture; can always be clicked
  through; never hard-blocks.
- Wording states measured value **and** expected range, e.g. *"Gewicht 25 g liegt außerhalb
  des erwarteten Bereichs 7,5–10,7 g (Zaunkönig)"* — de-AT formatting.
- Applies in **create and edit** mode.

## 5. Org-admin editor (in-app, v1)

- New Admin-only surface (`IsOrgAdminOrReadOnly`), ADR 0016 in-app-admin pattern.
- **List** of species with an effective norm (label each *Standard* vs *angepasst*) +
  "Artennorm hinzufügen" (species search → override any species, even one with no default).
- **Per-species MatDialog**, pre-filled from the effective (default) values.
- **Auf Standard zurücksetzen** = delete the org override row (fall back to default).
- The Admin edits **only org overrides**, never the shared global defaults.

## 6. Delivery online & offline

- One small **per-org effective-Artennormen list keyed by `species_id`** (server resolves
  `override ?? default` for the active Projekt's Organisation).
- Fetched-and-cached online; embedded in `OfflineBundleView` next to the species pool.
- Client looks up `norms[species.id]` on species selection — **identical path online and
  offline**. The ~1M-row `SpeciesViewSet` autocomplete stays untouched (global reference
  data, not org-aware).

## 7. Server stays out of enforcement

`DataEntrySerializer`, `capture_service`, and the IWM import are **unchanged** with
respect to plausibility. The server never runs the Ausreißertest and never blocks — in
particular IWM-imported historical rows may legitimately be "unusual" and must import
without warnings. Plausibility is purely a data-entry client concern.

## 8. Seed migration

- `0022_seed_austrian_ring_sizes.py`-pattern: a **static dict literal embedded in the
  migration** (not the xlsx read at runtime), keyed by **`scientific_name`**, writing
  `organization = NULL` rows, with matched/unmatched reporting.
- Built from the **finalized** `docs/Korrekturebenen.xlsx` (Tarsus column added first).
- Kerbe F2 and Innenfuß columns ship **null** (no data yet).

## 9. German → wissenschaftlich mapping (verified)

All 11 `scientific_name` keys confirmed present in `backend/birds/migrations/artenliste_2024.csv`
(zero unmatched):

| xlsx `Artname D` | `scientific_name` (seed key) | DB `common_name_de` |
|---|---|---|
| Teichrohrsänger | `Acrocephalus scirpaceus` | Teichrohrsänger |
| Bartmeise | `Panurus biarmicus` | Bartmeise |
| Drosselrohrsänger | `Acrocephalus arundinaceus` | Drosselrohrsänger |
| Haussperling | `Passer domesticus` | Haussperling |
| Mariskensänger | `Acrocephalus melanopogon` | **Mariskenrohrsänger** (name differs) |
| Mönchsgrasmücke | `Sylvia atricapilla` | Mönchsgrasmücke |
| Nachtigall | `Luscinia megarhynchos` | Nachtigall |
| Rohrschwirl | `Locustella luscinioides` | Rohrschwirl |
| Schilfrohrsänger | `Acrocephalus schoenobaenus` | Schilfrohrsänger |
| Singdrossel | `Turdus philomelos` | Singdrossel |
| Neuntöter | `Lanius collurio` | Neuntöter |

`Mariskensänger`/`Mariskenrohrsänger` is the concrete reason for keying on
`scientific_name` (§8): a `common_name_de` match would have missed it.

## 10. Open before implementation

- **User**: finalize `docs/Korrekturebenen.xlsx` with a Tarsus column.
- Nail exactly which `hand_wing` (`HandWingMoult`) values count as "Handschwingenmauser
  vorhanden" for the dj-flag — read the enum before wiring §1's last rule.

**Out of scope (v1):** sex/age/size-split norms; server-side enforcement; storing the
acknowledgment.
