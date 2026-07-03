# Zentrale & ausländische Wiederfänge (resolved design)

Foreign recaptures (ausländische Wiederfänge) carry rings issued under other
countries' conventions: the size letter codes differ per scheme (an Austrian
"V" is a Slovak "S"), and the IWM export's **Ring** column must name the
Zentrale of the ring's original Beringung — today it hardcodes `AUW`.

Grilled and resolved on 2026-07-03. Glossary: `CONTEXT.md` (Zentrale,
Ringgröße, Projekt, Erstfang/Wiederfang, Organisation). Decision record:
ADR 0019 (extends ADR 0006).

## 1. Zentrale = EURING scheme

A **Zentrale** is precisely one EURING ringing scheme, identified by its
EURING scheme code (AUW = Österreichische Vogelwarte; Germany has three). New
model `Central`: `scheme_code` (unique), `name`, `country`. **Seed the full
published EURING scheme list** (~100 rows) as global reference data — like
`Species`, never tenant-scoped. "Scheme unknown" is not a modelled state: the
Beringer can always identify the Zentrale (searchable by name/country/code —
foreign rings are inscribed with the central's address, not its code).

## 2. Ring model: Zentrale joins, Organisation stays (ADR 0019)

`Ring` gains a `central` FK (migration backfills every existing Ring to AUW).
`Ring.organization` **stays** — it is the tenant-isolation boundary (ADR
0006), not a domain error. Uniqueness becomes
`(organization, central, size, number)`. The real-world uniqueness of a
Zentrale's namespace is deliberately not enforced across tenants (demo-tenant
squatting, unfixable cross-tenant typo collisions, ring production errors —
see ADR 0019).

## 3. Ringgröße validation keyed to the ring's Zentrale

Not a UI-gesture rule ("field was overridden") but a backend rule usable by
offline sync and import alike: a Ringgröße is validated against the **known
size conventions of the ring's Zentrale**. Modelled today for AUW only (the
28 Austrian codes); any other Zentrale ⇒ free text — trimmed, uppercased,
length-capped (~10), **never empty**. One `size` column; the serializer's
`ChoiceField` becomes conditional. An Erstfang always carries the
Projekt-Zentrale, so free-form Größen exist only on Wiederfängen; the
`next-number` rope suggestion counts only Erstfang/Ring-vernichtet entries
and therefore never sees foreign sizes.

## 4. Projekt-Zentrale: modelled, not yet surfaced

`Project.central` FK, default AUW, backfilled for all existing Projekte.
**No selector in project settings yet** — every user today is Austrian, and a
non-AUW Projekt-Zentrale would silently turn all its Erstfänge free-text.
Exposing the knob is a one-line UI change once a second real Zentrale user
exists.

## 5. Data entry

Field **"Zentrale" sits in the ring block**: Status → Zentrale → Ringgröße →
Ringnummer (not after the Projekt display field — editability is decided by
Status, and keyboard flow must stay linear).

- **Erstfang and Ring vernichtet**: visible but disabled, forced to the
  Projekt-Zentrale (Ring vernichtet draws from the own rope).
- **Wiederfang**: enabled, prefilled with the Projekt-Zentrale, searchable
  dropdown. While value ≠ Projekt-Zentrale: Ringgröße becomes free text,
  **Ringnummer drops its numeric-only pattern** (foreign numbers may contain
  letters), Empfohlene-Ringgröße prefill is suppressed. Switching back
  restores the dropdown (clears a non-Austrian value).
- Status flip back to Erstfang resets the Zentrale to the Projekt default.
- **Not sticky** across saves (unlike Station/Beringer) — a foreign recapture
  is an exception, not session state.
- Edit mode keys off the ring's stored Zentrale, not UI history.
- Server: write payload carries the central flat (like `ring_size`); when
  **omitted it defaults to the Projekt-Zentrale** (pre-feature offline outbox
  entries must replay cleanly after deploy). Erstfang/Ring-vernichtet with a
  central ≠ Projekt-Zentrale is rejected with a German detail message.

## 6. IWM export

`Ring` column emits `ring.central.scheme_code` (backfill guarantees non-null).
`Ringnummer` stays the plain `size + number` concatenation for foreign rings
too — write what was read.

## 7. IWM import learns foreign rows (level 3)

Today the import ignores the `Ring` column entirely: a Slovak S 1234 silently
imports as an Austrian ring ("S" is also an Austrian size), and other foreign
rows fail opaquely — and the new export would no longer round-trip. Fix:

- `Ring` column absent/blank ⇒ AUW (backward compatible with old sheets).
- `Ring` = AUW ⇒ strict Austrian parsing, as today.
- `Ring` = another known scheme code ⇒ central set to that scheme; Ringnummer
  split by the generic letters+digits regex into free-text Größe + Nummer.
- Unsplittable Ringnummer or unknown scheme code ⇒ row rejected with a clear
  German message ("ausländischer Wiederfang — bitte manuell erfassen"-style),
  never a silent mis-import.

## 8. Offline

The offline bundle gains the **Zentralen list**; bundled Projekte carry their
Zentrale; queued entries carry the central flat (absent ⇒ server default per
§5). The offline ring-number suggestion needs no change (§3). Items 2–4 are
consequences to verify in tests, not new decisions.
