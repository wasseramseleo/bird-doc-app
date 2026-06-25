---
status: accepted
---

# IWM export: capture-context on Project, geography on Station

The IWM `Fangdaten` export needs columns the app didn't model: capture method (Fangmethode), lure (Lockmittel), and circumstance (Umstand), plus the site's country (Land), region, place code (Ortskodierung) and geo-coordinates. We model **capture-context (Fangmethode / Lockmittel / Umstand) as constant attributes of the `Project`**, and **all geography (country / region / place_code / latitude / longitude) as attributes of the `RingingStation`** — the export reads them from each entry's `project` and `ringing_station`.

## Considered Options

- **Capture-context per `DataEntry`.** EURING/IWM technically records catching method, lure and circumstance per capture, so per-entry is the "faithful" model. Rejected for now: in a standard mist-net monitoring project these never vary, so per-entry would be pure data-entry friction for the Beringer with no real signal. Per-entry override is left as a future extension.
- **Country from `Organization.country`.** `Organization` already carries a `country` field, so reusing it was tempting. Rejected: a Projekt can receive data from multiple Stations (the feedback says so explicitly), and country/region/place/coordinates are all properties of the *site*, not the scheme body. Putting them on the Station keeps the export reading one coherent source. `Organization.country` is left untouched and unused by the export.

## Consequences

- Editing these attributes is **admin-only**; existing Station and Project rows are seeded by data migration (Linz, Botanischer Garten → Austria / Oberösterreich / AU03 / 48.295892, 14.276697; default project → Umstand 25 / Fangmethode M / Lockmittel N).
- Because capture-context is per-project, a project mixing genuinely different capture methods cannot be represented until per-entry override is added.
- `Fangmethode` and `Lockmittel` are modelled as controlled choices (validated against IWM codes) since a typo would corrupt a regulated submission; `Umstand` is a plain field defaulting to "25".

## Reference

The export's target column layout is reproduced from [`docs/IWM_Linz_Vogelmonitoring_2026-06-24.xlsx`](../IWM_Linz_Vogelmonitoring_2026-06-24.xlsx) — the IWM-provided `Fangdaten` sheet that `iwm_export.py` (`build_iwm_workbook`) is written to match.
