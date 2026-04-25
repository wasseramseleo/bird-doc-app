# Architecture

## System Overview

```
┌─────────────────────────────────────┐      HTTP / JSON
│  Angular 20 SPA  (localhost:4200)   │ ──────────────────▶  Django REST API
│                                     │                       (localhost:8000)
│  DataEntryFormComponent             │  POST /api/birds/data-entries/
│  NavBarComponent                    │  GET  /api/birds/species/?search=…
│                                     │  GET  /api/birds/rings/next-number?size=V
│  ApiService  ──  HTTP Client        │  GET  /api/birds/ringing-stations/
│  models/     ──  TS interfaces      │  GET  /api/birds/scientists/
└─────────────────────────────────────┘
                                                      │
                                              ┌───────▼────────┐
                                              │  SQLite DB      │
                                              │  (dev only)     │
                                              └────────────────┘
```

## Backend (`backend/`)

**Stack:** Python 3.13, Django 5.2, Django REST Framework 3.16, SQLite

Single Django app (`birds/`) with project config in `birddoc/`. All routes are under `/api/birds/` via a DRF `DefaultRouter`.

### Models

| Model | Role |
|-------|------|
| `DataEntry` | Core record — one row per captured bird |
| `Ring` | Unique `(size, number)` pair; sizes: `V T S X P` |
| `Species` | ~1M-row lookup table with recommended ring size |
| `Scientist` | OneToOne with Django User; identified by `handle` (e.g. `MUS`) |
| `RingingStation` | `handle` as PK (e.g. `STAMT`), name |
| `SpeciesList` | Per-user M2M to Species for filtering |

### API Endpoints

| Endpoint | Access | Notes |
|----------|--------|-------|
| `/data-entries/` | Public CRUD | Core capture records |
| `/species/` | Public read + search | Filter by user's active SpeciesList if authenticated |
| `/rings/` | Public read | All rings |
| `/rings/next-number?size=<size>` | Public | Returns `max(number) + 1` for that ring size |
| `/ringing-stations/` | Public read + search | |
| `/scientists/` | Public read + search | |
| `/species-lists/` | Authenticated CRUD | Per-user species filter lists |

### Key Design Decisions

**Ring lifecycle managed server-side** — Clients never POST to `/rings/`. A `DataEntry` write includes `ring_number` + `ring_size`; `DataEntrySerializer._get_or_create_ring()` creates or reuses the Ring. When a DataEntry's ring changes, the orphaned Ring is deleted transactionally (`serializers.py`).

**Write vs. read shape** — POST/PUT/PATCH accepts flat IDs (`species_id`, `staff_id`, `ringing_station_id`, `ring_number`, `ring_size`). GET returns nested objects. The two shapes are intentionally different — never use GET response bodies as POST payloads.

**Species filtering** — `SpeciesViewSet.get_queryset()` returns only species in the user's active `SpeciesList` when authenticated. Unauthenticated requests see all species. Only one `SpeciesList` per user can have `is_active=True` (enforced in `SpeciesList.save()`).

**Smart ring numbering** — `next-number` casts all existing numbers to `int` and returns `max + 1`, tolerating gaps and non-numeric legacy values.

## Frontend (`frontend/`)

**Stack:** Angular 20, TypeScript 5.8, Angular Material, Bootstrap 5, RxJS 7

Single-page app with one primary route (`/`) rendering `DataEntryFormComponent`.

### Component Structure

```
AppComponent
└── NavBarComponent
└── DataEntryFormComponent       (main form — create / edit modes)
    └── DataEntryDetailDialogComponent   (view-only record detail)
```

### Key Files

| File | Role |
|------|------|
| `src/app/data-entry-form/data-entry-form.ts` | Main form: autocomplete, ring lookup, submit |
| `src/app/service/api.service.ts` | All HTTP calls to the Django backend |
| `src/app/models/` | TypeScript interfaces mirroring backend models |
| `src/app/core/directives/select-on-tab.ts` | Confirms autocomplete option on Tab |
| `src/app/shared/directives/focus-next.ts` | Advances focus to next field on Enter/selection |

### Data Flow

1. Autocomplete fields (species, ringing station, scientist) use `valueChanges → debounceTime(300) → switchMap` to hit the API.
2. Selecting a species pre-fills `ring_size` from `species.ring_size`.
3. When `ring_size` + `BirdStatus.FirstCatch` are both set, the next ring number is fetched automatically via an Angular `effect()`.
4. On submit, `transformFromForm()` flattens nested objects to flat IDs before POSTing or PUTting.
5. After a successful save, `clearForm()` resets all fields except `ringing_station`, `staff`, and `organization`.

### Angular Conventions

- Standalone components (default in Angular 20 — do not set `standalone: true` explicitly)
- Signals and `computed()` for state; `input()` / `output()` functions not decorators
- `ChangeDetectionStrategy.OnPush` on every component
- Native control flow: `@if`, `@for`, `@switch`
- `inject()` for DI; `providedIn: 'root'` for singleton services
- Reactive forms only

### Locale

`LOCALE_ID: 'de-AT'` (Austrian German). All date and float formatting must use Austrian German conventions.

### Keyboard UX

`SelectOnTabDirective` confirms the highlighted autocomplete option on Tab and advances focus. Single-character shortcuts (the `key` property of `SelectOption`) are mapped to enum values for `MatSelect` fields, then `focusNext()` advances through `focusOrder`.
