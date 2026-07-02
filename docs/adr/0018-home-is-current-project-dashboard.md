---
status: accepted
---

# The logged-in home is the current Projekt's dashboard, not just a picker

## Context

The Visualisierung feature is scoped **per Projekt** (each chart is about one
project), and the feature doc places it "auf der Homepage," to grow "schritt für
schritt zu einem Dashboard." That collides with what the home is today: the
Angular `HomeComponent` at `/` is a **project picker**, and selecting a card
navigates away to `/data-entries`. So the page named as the target is the one
place where no single project is in view — and users rarely sit on it with a
project selected.

Two things already in the app make a cleaner reconception possible:

- `ProjectService.currentProject` is a **persisted signal**, rehydrated on
  reload — the app already knows "the project you're working in."
- The nav bar already has a **project switcher** menu (with an "Alle Projekte …"
  path back to the picker), so switching projects does not depend on the home
  page being a picker.

## Decision

The home route `/` **becomes the current project's dashboard**: when a
`currentProject` is set, `/` renders that project's charts and stat card; when
none is selected, `/` shows the project picker as its empty / no-selection state.
Switching projects happens through the existing nav-bar switcher. The picker
survives as a state of the home, not as the home's identity.

## Considered options

- **A separate `/dashboard` route.** Cleanest separation and easiest to grow,
  but it is literally not "on the homepage," and it adds a place to navigate to
  rather than making the home itself the destination. Rejected for v1 to match
  the doc's intent; can be revisited if the home gets crowded.
- **A dashboard section stacked under the picker cards.** Purely additive and
  low-risk, but mixes two mental modes on one page ("choose a project" above
  "stats for one project"). Rejected as a busier, less coherent surface.
- **Per-card sparklines + drill-in.** A nice cross-project overview, but more
  work up front and it fights the picker's simplicity. Deferred to the org-level
  rollup (phase 2), not the per-project v1.

## Consequences

- One navigation tweak is implied: with the home now meaningful for a selected
  project, selecting/switching a project can land on (or offer) the home
  dashboard, not only jump straight to `/data-entries`.
- A future reader will wonder why `/` is a dashboard rather than the picker the
  code history shows — this ADR records that it was a deliberate reconception
  driven by per-project scope + the persisted `currentProject` + the existing
  nav switcher, not an accident.
- The picker's behaviour is preserved for new users and users with no current
  project, so nobody loses the ability to choose a project.
