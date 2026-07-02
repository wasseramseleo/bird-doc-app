---
status: accepted
---

# Visualisation charting: Chart.js used directly, no Angular wrapper

## Context

The Visualisierung feature adds capture charts to the logged-in home (bar chart
of häufigste Arten, a top-N species-per-day line chart, a "Letzter Tag" stat
card), meant to grow into a dashboard. No charting library was installed, so the
library was a genuine open decision (the feature doc calls it out explicitly:
"Design entscheidung, welche libraries für visualisierung verwendet werden
soll").

Three constraints shaped the choice:

- **Angular is on a bleeding edge (21.x).** Angular-wrapper charting libraries
  (`ngx-charts`, `ng2-charts`) only work on the Angular versions they declare
  peer support for. A wrapper without a v21-compatible release means install
  friction (`--legacy-peer-deps`) and a recurring upgrade drag on every future
  Angular bump — the wrapper, not us, gates the Angular version.
- **Offline-first PWA (PRD #152).** The service worker caches the whole app, so
  every kilobyte of charting code is downloaded and cached on every field
  device. Bundle size is a real cost, not a footnote.
- **The charts are simple but the dashboard grows.** Bar, line, stat tiles for
  v1; more (Tagesfangkurve, Artenakkumulation, org rollups) later. We want axes,
  tooltips, legends and responsiveness for free, without adopting a heavy
  framework.

## Decision

Use **Chart.js directly** — the framework-agnostic library, rendered from a
standalone Angular component via a `<canvas>` ref (`afterNextRender`) — **without
an Angular wrapper**. Register only the chart types actually used so the bundle
stays tree-shaken.

## Considered options

- **`ngx-charts` (Angular-native, SVG, declarative).** Nicest DX and cleanest
  Material/signals fit *if* it supports Angular 21 — which is exactly the risk.
  Rejected as the primary choice because it re-couples our Angular-version
  freedom to a third party's release cadence, on a version that is currently
  ahead of most of the ecosystem.
- **`ng2-charts` (Chart.js under an Angular wrapper).** Same rendering engine we
  chose, but re-introduces the Angular-version peer-dep coupling that using
  Chart.js directly avoids. The ergonomic `[data]`/`[type]` bindings were judged
  not worth the coupling for the handful of charts planned.
- **Hand-rolled SVG components.** Zero dependency and smallest possible bundle,
  but we would build axes, tooltips, legend and responsiveness ourselves —
  slowing down a dashboard that is meant to keep growing. Rejected as premature
  cost.

## Consequences

- Charts are created imperatively against a canvas in the component's render
  hook, not via Angular templates — slightly more wiring per chart than a
  declarative wrapper, in exchange for immunity to the Angular-21 wrapper-lag
  problem.
- Adding chart types later means registering the new controllers/elements
  explicitly (the price of tree-shaking) — a small, deliberate step, not a
  surprise.
- Theming is done through Chart.js options wired to the app's Material tokens,
  keeping the charts visually part of the app rather than a bolt-on widget set.
- Reversing this (e.g. to `ngx-charts`) gets costlier per chart built, which is
  why it is recorded now rather than after the dashboard has grown.
