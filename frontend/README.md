# BirdDoc — Frontend

Angular 20 single-page application for bird ringing field data entry. Captures per-bird measurements and ring assignments through a keyboard-optimised form.

## Prerequisites

- Node.js 20+
- Angular CLI (`npm install -g @angular/cli`)
- Django backend running at `http://localhost:8000` (see `../backend/README.md`)

## Setup

```bash
npm install
ng serve        # Dev server at http://localhost:4200
```

## Commands

```bash
ng serve                          # Dev server with live reload
ng build                          # Production build → dist/bird-doc/
ng build --configuration development  # Dev build (no optimisation)
ng test                           # Unit tests via Karma/Jasmine
ng generate component <name>      # Scaffold a new standalone component
```

## Project Structure

```
src/app/
├── data-entry-form/
│   ├── data-entry-form.ts        # Main form component (create/edit)
│   └── data-entry-detail-dialog/ # View-only record detail dialog
├── nav-bar/                      # Top navigation bar
├── service/
│   └── api.service.ts            # All HTTP calls to the backend
├── models/                       # TypeScript interfaces mirroring Django models
├── core/directives/
│   └── select-on-tab.ts          # Confirms autocomplete on Tab keypress
└── shared/directives/
    └── focus-next.ts             # Advances focus to next field on Enter/selection
```

## Key Behaviours

**Autocomplete fields** (species, ringing station, scientist) debounce 300 ms before hitting the API via `switchMap`. Selecting a species automatically pre-fills the ring size.

**Auto ring number** — when ring size and `BirdStatus.FirstCatch` are both set, the next ring number is fetched via a reactive `effect()`.

**Form submit** — `transformFromForm()` flattens nested objects to flat write IDs (`species_id`, `staff_id`, `ringing_station_id`) before POST/PUT. After a successful save, `clearForm()` resets everything except station, scientist, and organisation.

**Keyboard UX** — single-character shortcuts on `MatSelect` fields advance focus automatically through `focusOrder`. Tab on open autocomplete confirms the highlighted option.

## Locale

`LOCALE_ID: 'de-AT'` (Austrian German). All dates and decimals are formatted in Austrian German conventions.
