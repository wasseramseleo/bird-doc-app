# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
ng serve          # Dev server at http://localhost:4200
ng build          # Production build → dist/
ng test           # Unit tests via Karma/Jasmine
ng generate component <name>  # Scaffold a new standalone component
```

The Django REST Framework backend must be running separately at `http://localhost:8000` (see `../backend/CLAUDE.md`).

## Architecture

Single-page Angular 20 app for bird-ringing field data entry. The app has one primary route (`/`) rendering `DataEntryFormComponent`, with a `NavBarComponent` at the top.

**Key files:**
- `src/app/data-entry-form/data-entry-form.ts` — the main form component; handles create/edit modes, autocomplete search, ring history lookup, and form submission
- `src/app/service/api.service.ts` — all HTTP calls to the Django backend (`http://localhost:8000/api/birds/`)
- `src/app/models/` — TypeScript interfaces and enums mirroring backend models
- `src/app/core/directives/select-on-tab.ts` — selects the active autocomplete option on Tab keypress
- `src/app/shared/directives/focus-next.ts` — advances focus to the next form field on Enter/selection

**Data flow:**
1. Autocomplete fields (species, ringing station, scientist) use RxJS `valueChanges` → `debounceTime(300)` → `switchMap` to the API
2. When a species is selected, its `ring_size` pre-fills the ring size selector
3. When ring size + `BirdStatus.FirstCatch` are set, the next ring number is fetched automatically via an Angular `effect()`
4. On submit, `transformFromForm()` converts nested objects to flat write-only IDs (`species_id`, `staff_id`, `ringing_station_id`) before POSTing/PUTting
5. After a successful save, `clearForm()` resets all fields except `ringing_station`, `staff`, and `organization`

**Read vs. write shape:** The API returns nested objects on GET but expects flat IDs on POST/PUT/PATCH — the two shapes are intentionally different. Never POST to `/rings/` directly; send `ring_number` + `ring_size` and the backend handles ring creation.

## Angular conventions (from LLM.md)

- Standalone components only — do **not** set `standalone: true` explicitly (it's the default in Angular 20)
- Use `input()` / `output()` functions, not `@Input`/`@Output` decorators
- Use signals and `computed()` for state; do **not** use `mutate()` on signals
- `ChangeDetectionStrategy.OnPush` on every component
- Native control flow: `@if`, `@for`, `@switch` — not `*ngIf`/`*ngFor`
- `class` bindings instead of `ngClass`; `style` bindings instead of `ngStyle`
- `inject()` function for DI, not constructor injection
- `providedIn: 'root'` for singleton services
- Reactive forms, not template-driven forms
- Do **not** use `@HostBinding` / `@HostListener` — put host bindings in the `host` object of the decorator instead

## Locale

The app is configured with `LOCALE_ID: 'de-AT'` (Austrian German). All date and float values must be formatted using Austria German conventions.

## Keyboard UX pattern

`SelectOnTabDirective` (`input[selectOnTab]`) confirms the highlighted autocomplete option on Tab and advances focus. `DataEntryFormComponent.onSelectKeydown()` maps single-character shortcuts (`key` property of `SelectOption`) to enum values for `MatSelect` fields and then calls `focusNext()` to advance focus through `focusOrder`.
