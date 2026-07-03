---
status: accepted
---

# The project picker is a dedicated `/projekte` route; `/` redirects there when no Projekt is selected

## Context

ADR 0018 made the home route `/` the current Projekt's dashboard, and kept the
project picker alive as the home's **no-selection state** (the `@else` branch of
`HomeComponent`). That reuse has a sharp edge, reported as beta-user feedback
(issue #221): `ProjectService.currentProject` is a persisted signal that survives
navigation, so once a Projekt is selected, `/` always re-renders that Projekt's
dashboard. The nav-bar Projekt-Switcher's "Alle Projekte …" item pointed at `/`,
so with a Projekt active it re-rendered the dashboard rather than the picker —
i.e. "Alle Projekte …" appeared to do nothing. There was no URL at which a user
with a current Projekt could see the list of all their Projekte.

## Decision

Give the picker its own home. A new route **`/projekte`** (guarded by `authGuard`)
renders a standalone **`ProjectPickerComponent`** — the pre-Visualisierung picker,
listing every Projekt visible to the user, with per-row open/select, "Bearbeiten"
and IWM-Export, and a "Neues Projekt" create action.

- The nav-bar "Alle Projekte …" item navigates to `/projekte` and **does not**
  clear `currentProject`, so the Switcher stays visible and the user can return to
  their dashboard.
- `/` stays the current Projekt's dashboard (ADR 0018). When **no** Projekt is
  selected, a functional guard (`projectSelectedGuard`) redirects `/` to
  `/projekte`. The guard reads `ProjectService.currentProject()`, which rehydrates
  synchronously from storage, so a reload straight into `/` still lands on the
  dashboard.
- The picker is rendered in **exactly one place** now (`ProjectPickerComponent`);
  `HomeComponent` no longer carries the picker markup or its `@else` block.
- Project create / edit / IWM-Export move out of `HomeComponent` into a new
  root-provided **`ProjectActionsService`** — the single source of truth for those
  operations (dialog → API → German snackbars → `ProjectService.upsertProject`,
  and `setCurrent` when the edited Projekt is the current one). The picker consumes
  it; the Projekt dashboard can become a second consumer in a follow-up slice.

## Considered options

- **Keep the picker as the home's `@else` state (status quo, ADR 0018).** No new
  route, but it is precisely the state that a persisted `currentProject` makes
  unreachable — the bug being fixed. Rejected.
- **Clear `currentProject` on "Alle Projekte …" so `/` falls back to the picker.**
  Restores the list at `/`, but drops the user's working context and hides the
  Switcher, making the round-trip back to the dashboard a re-selection. Rejected:
  browsing all Projekte shouldn't deselect the one you're working in.
- **A dedicated `/projekte` route (chosen).** A stable, linkable URL for the
  picker that is independent of selection state, leaving `/` free to always mean
  "the current Projekt's dashboard".

## Consequences

- This refines ADR 0018: the picker is no longer only the home's no-selection
  state — it is reachable at `/projekte` regardless of whether a Projekt is
  selected, and `/` redirects there when none is.
- `ProjectActionsService` centralises the create/edit/export wiring, removing the
  duplicated dialog-open and IWM blob-download logic from `HomeComponent` and
  giving the future dashboard a ready-made second consumer.
