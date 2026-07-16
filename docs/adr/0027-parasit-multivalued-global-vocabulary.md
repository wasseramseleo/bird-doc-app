---
status: accepted
---

# Parasit is a multi-valued global-vocabulary field, replacing the has_mites boolean

## Context

Beta-user feedback (user-feedback.md #7) reorganises the capture's optional
flags. The three remaining indicators stay **Ja/Nein** booleans in a new order —
Brutfleck (`has_brood_patch`), CPL+ (`has_cpl_plus`), Hungerstreifen
(`has_hunger_stripes`) — but **Milben** (`has_mites`) is generalised into a
**Parasit** field: a *Mehrfachauswahl* of parasite types, of which Milben is one.
A single capture can carry several parasite types at once.

The concrete option set (#7b, "~4 verschiedene Möglichkeiten") was **pending from
the user** when this ADR was first written; the structural shape was settled then,
independently of the exact values. The list has since landed (issue #406) and is
recorded under *Vocabulary* below.

Two constraints bound the storage choice:

- Dev **and the test suite run on sqlite** (`settings_test.py` forces it); only
  prod is Postgres. So a Postgres `ArrayField` is unavailable where the tests run.
- The vocabulary will grow as the user finalises the list, and possibly later.

## Decision

Replace `has_mites` with a single **multi-valued Parasit field** on `DataEntry`,
backed by a **fixed, app-wide code vocabulary** (defined in code, identical for
every Organisation — reference data, like the IWM codes, not tenant-configurable).

- **Storage** — a Django **`JSONField` holding a list of choice codes** (e.g.
  `["mites"]`). Portable across sqlite and Postgres, and JSON-friendly for the
  offline bundle / outbox. Not a Postgres `ArrayField` (sqlite tests), not
  per-option boolean columns.
- **UI** — a Mehrfachauswahl rendered beside the three Ja/Nein flags, in the #7a
  order: Brutfleck, CPL+, Hungerstreifen, then Parasit.
- **Migration** — `has_mites=True` → `parasites=["mites"]`; the `has_mites` column
  is dropped. The vocabulary grows (or shrinks — ADR 0031) by editing enum values,
  with no schema change.
- **Validation** — the write path validates against the vocabulary:
  `ListField(child=ChoiceField(choices=DataEntry.Parasit.choices))` on
  `DataEntrySerializer` (issue #406). The `JSONField` carries no `choices` and
  `full_clean()` never runs on the create path, so without this `parasites:
  ["banana", 42]` persisted in silence. It has to be enforced *here* because both
  consumers swallow an unknown code by design — `_PARASIT_LABELS.get(code, code)`
  falls back to the raw string — so with the vocabulary mirrored by hand in two
  enums, a typo would otherwise reach the Meldestelle as a literal `white_mites`
  in the Bemerkungen column, failing nowhere.
- **Export** — the IWM template has no Parasit column, so the selected parasite
  types continue to be written into the **Bemerkungen** column (exactly as Milben
  is today), each selected type listed.
- **Not org-configurable** — the types are a shared field vocabulary, not tenant
  data.

### Vocabulary

The five types the user settled on (issue #406), in this order — mirrored **by
hand** in `backend/birds/models.py::DataEntry.Parasit` and
`frontend/src/app/models/data-entry.model.ts::Parasit` / `PARASIT_OPTIONS`:

| Code | Label |
|---|---|
| `red_mites` | Rote Milben |
| `white_mites` | Weiße Milben |
| `tick` | Zecke |
| `feather_lice` | Federlinge |
| `louse_fly` | Lausfliege |

The original catch-all `mites` ("Milben") is **retired**: the user's ruling is that
it always meant *Dermanyssus gallinae*, so it maps onto `red_mites`. It remains a
valid *input* for the offline window and is rewritten on write — see **ADR 0031**,
which owns that pattern.

## Considered options

- **Per-option boolean columns** (`has_mites`, `has_ticks`, …) — rejected: each
  new type is a column + migration + offline-model + serializer change, and it is
  not a natural multi-select. This is why Parasit is deliberately shaped
  *unlike* its Ja/Nein siblings.
- **Postgres `ArrayField`** — rejected: the dev/test database is sqlite, which
  cannot use it, so the suite would not run.
- **M2M to an org-scoped `ParasitTyp` table** — rejected as over-engineered for a
  small closed code set; a JSON list keeps the vocabulary in code with the other
  IWM-style codes. Revisit only if per-Organisation parasite types are ever
  genuinely needed.

## Consequences

- Parasit is multi-valued by nature and therefore shaped differently from the
  Brutfleck/CPL+/Hungerstreifen booleans — by design, not oversight.
- Adding a parasite type is a one-line enum change plus a label; no migration.
- The two hand-mirrored enums are the standing risk this shape carries; the
  serializer's ChoiceField is what keeps a drift loud instead of silent.
- See the **Parasit** entry in CONTEXT.md.
