---
status: accepted
---

# Configurable per-Projekt Saison (month window) drives a "Diese Saison" dashboard preset

## Context

The Projekt-Dashboard offers range presets — `Letzte Woche / Letzter Monat /
Dieses Jahr / Alles` plus a custom Von/Bis range — resolved **backend-side** in
`project_stats.py::resolve_range` against a Europe/Vienna "today". Until now
**Saison was deliberately unmodelled** (CONTEXT.md; a code comment states "'per
Saison' is served by *Dieses Jahr* / a custom range — no Saison entity exists").

Beta-user feedback (item B) asks for two more presets — **Heute** and **Diese
Saison** — and notes the season differs per project (IWM Nov–März, ZUG Jul–Okt),
so "Diese Saison" can only work if each Projekt can define its own season.

## Decision

Add the two presets and model an **optional per-Projekt Saison** as a recurring
**month window**.

- **Heute** — an additive preset; `date_from = date_to = Vienna today`.
- **Saison window** — two nullable month fields on `Project` (`saison_start_month`,
  `saison_end_month`, 1–12), **inclusive** and **wrap-around allowed**: when
  `start > end` the window spans the year boundary (Nov = 11 → März = 3). No
  separate Saison entity/row — just two fields on the Projekt. Null ⇒ no season
  configured.
- **No Projekttyp coupling** — the season is set **manually** per Projekt; the
  Projekttyp does not even seed a default (a stronger decoupling than ADR 0023's
  seed-only allowance, chosen by the user).
- **"Diese Saison" resolution** against Vienna today `T`:
  - `T` inside the current occurrence of the window ⇒ `from = that occurrence's
    start`, `to = T` (capped at today — never a future date).
  - `T` off-season ⇒ the **most-recently-ended** occurrence `[start, end]`, so the
    dashboard immediately shows the last season's result.
  This always yields a populated, meaningful range.
- **Surface** — the "Diese Saison" preset button is shown **only** when the Projekt
  has a season configured, else hidden. The season is configured in the Projekt
  settings (Admin-only, like the rest of Projektverwaltung). Backend resolves the
  preset; the dashboard stats endpoint is online-only (ADR 0017), so there is no
  offline-bundle change.

## Considered options

- **Day-precision season (start/end day+month).** Rejected — month granularity
  matches the monitoring reality and the examples; day precision is unneeded.
- **Calendar-year-clipped season.** Rejected — it cuts a Nov–März season in half at
  the year boundary.
- **Only the current season (disabled off-season).** Rejected — off-season the
  dashboard would show nothing; "letzte Saison" is exactly what the user wants to
  see.
- **Seed months from the Projekttyp.** Rejected — the user chose full decoupling;
  the type neither drives nor seeds the season.
- **A separate Saison entity with explicit per-year start/end dates.** Rejected as
  over-engineered; a recurring month window covers the need without a row per year.

## Consequences

- Reverses the "no start/end on a Projekt" clause of the CONTEXT.md **Saison**
  entry: a Saison is now an optional per-Projekt recurring month window — but still
  **not a separate entity/row**, and still expressed to the user only as a date
  range over the Fangtage.
- Wrap-around and off-season logic live in `project_stats.py` beside the other
  preset bounds, which now receive the Projekt's season months.
- See the **Saison** entry in CONTEXT.md.
