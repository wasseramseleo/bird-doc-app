# Architecture

## System Overview

```
┌─────────────────────────────────────┐      HTTP / JSON
│  Angular 21 SPA  (localhost:4200)   │ ──────────────────▶  Django REST API
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

## Deployment Topology

```
                        Internet
                           │ HTTPS
                           ▼
                    Cloudflare Edge
                           │ Tunnel
                           ▼
        ┌────────── Proxmox LXC ──────────────┐
        │                                     │
        │  cloudflared (systemd)              │
        │     │                               │
        │     ▼  http://127.0.0.1:80          │
        │  Caddy ──┬─▶ /api/*, /admin/*  → backend:8000  (gunicorn, UID 1001)
        │          ├─▶ /static/*         → /srv/staticfiles  (shared volume)
        │          └─▶ /                 → frontend:80       (nginx + Angular bundle)
        │                                                    │
        │                                                    ▼
        │                                          Postgres 16 (named volume)
        │                                                    ▲
        └─────────────── tailscaled ─────────────────────────┘
                            ▲
                            │ Tailscale
                            │
              GitHub Actions runner ──▶ SSH ──▶ docker compose pull && up -d
```

- Public traffic enters via Cloudflare Tunnel only — the LXC publishes no host ports.
- Admin / deploy access is over Tailscale; `SSH_HOST` in GitHub secrets is the LXC's MagicDNS name.
- `staticfiles` is a named docker volume shared read-only into Caddy; it is seeded by `collectstatic` on every backend start.

## Backend (`backend/`)

**Stack:** Python 3.13, Django 5.2 (`>=5.2,<5.3`), Django REST Framework 3.16 (`>=3.16,<4`), SQLite (dev) / Postgres (prod)

Single Django app (`birds/`) with project config in `birddoc/`. All routes are under `/api/birds/` via a DRF `DefaultRouter`.

### Models

| Model | Role |
|-------|------|
| `DataEntry` | Core record — one row per captured bird |
| `Ring` | Unique `(size, number)` pair; full Austrian size scheme (frontend surfaces `V T S X P`) |
| `Species` | ~1M-row lookup table with recommended ring size |
| `Scientist` | The Beringer; OneToOne with Django User; identified by `handle` (e.g. `MUS`) |
| `RingingStation` | `handle` as PK (e.g. `STAMT`), name, belongs to an `Organization` |
| `Organization` | Ringing scheme/body; `handle` as PK |
| `Project` | Named campaign scoped to one `Organization` and a set of `Scientist` |
| `SpeciesList` | Per-user M2M to Species for filtering |

### API Endpoints

**The entire API requires authentication** — DRF defaults are `IsAuthenticated` + `SessionAuthentication` (`birddoc/settings.py`). There are no public endpoints; the "Access" column below describes the shape, not the auth level.

| Endpoint | Access | Notes |
|----------|--------|-------|
| `/data-entries/` | CRUD | Core capture records; filter by `?project`, or `?ring_size` + `?ring_number` |
| `/species/` | Read + search | Narrowed to the user's active SpeciesList when one exists; ordered by per-project usage frequency (`?project`) |
| `/rings/` | Read | All rings |
| `/rings/next-number?size=<size>&project=<id>` | Read | "Last consumed + 1" for that size in the project (see below) |
| `/ringing-stations/` | Read + search | Filterable by `organization` handle |
| `/scientists/` | Read + **Create** | List/retrieve plus authenticated create — a Beringer can be added mid-session (ADR 0001); no edit/delete |
| `/organizations/` | Read + search | |
| `/projects/` | CRUD | Scoped to the requesting user's Beringer |
| `/projects/{id}/export-iwm/` | Read | Streams the project's captures as an IWM `.xlsx` workbook |
| `/species-lists/` | CRUD | Per-user species filter lists |

### Key Design Decisions

**Ring lifecycle managed server-side** — Clients never POST to `/rings/`. A `DataEntry` write includes `ring_number` + `ring_size`; `DataEntrySerializer._get_or_create_ring()` creates or reuses the Ring. When a DataEntry's ring changes, the orphaned Ring is deleted transactionally (`serializers.py`).

**Write vs. read shape** — POST/PUT/PATCH accepts flat IDs (`species_id`, `staff_id`, `ringing_station_id`, `ring_number`, `ring_size`). GET returns nested objects. The two shapes are intentionally different — never use GET response bodies as POST payloads.

**Species filtering** — `SpeciesViewSet.get_queryset()` returns only species in the user's active `SpeciesList` when one exists; otherwise all species. The endpoint requires authentication either way. Only one `SpeciesList` per user can have `is_active=True` (enforced in `SpeciesList.save()`).

**Smart ring numbering** — `next-number` returns "last consumed + 1", **not** `max + 1`. It takes the project's most recent capture of that size that drew a fresh number from the rope — a first catch (Erstfang) **or** a destroyed-ring ("Ring vernichtet", `special_kind="ring_destroyed"`) record — ignoring recaptures (Wiederfänge), and increments it while preserving leading-zero width (`0042` → `0043`, returned as a string). Project-scoped; returns `null` when no qualifying capture exists or the previous number is non-numeric. See `CONTEXT.md` (Ringserie) and `birds/views.py`.

## Frontend (`frontend/`)

**Stack:** Angular 21.2, TypeScript 5.9, Angular Material, RxJS 7

Single-page app behind an auth gate. Routes:

| Route | Component | Guard |
|-------|-----------|-------|
| `/` | `HomeComponent` (project hub) | `authGuard` |
| `/login` | `LoginComponent` | `guestGuard` |
| `/data-entry` | `DataEntryFormComponent` (create) | `authGuard` |
| `/data-entry/:id` | `DataEntryFormComponent` (edit) | `authGuard` |
| `/data-entries` | `DataEntryListComponent` | `authGuard` |

### Component Structure

```
AppComponent
├── NavBarComponent          (rendered only when authenticated)
└── RouterOutlet
    ├── HomeComponent             (project hub — create/edit/switch projects)
    ├── LoginComponent
    ├── DataEntryFormComponent    (main form — create / edit modes)
    │   ├── DataEntryDetailDialogComponent   (view-only record detail)
    │   └── BeringerCreateDialogComponent    ("Neuer Beringer")
    └── DataEntryListComponent    (paginated capture list)
```

### Key Files

| File | Role |
|------|------|
| `src/app/home/` | Project hub: list/create/edit/switch projects (`project-create-dialog/`, `project-edit-dialog/`) |
| `src/app/data-entry-form/data-entry-form.ts` | Main form: autocomplete, ring lookup, submit |
| `src/app/data-entry-list/` | Paginated capture list view |
| `src/app/auth/login/` | Login screen |
| `src/app/service/api.service.ts` | All HTTP calls to the Django backend |
| `src/app/service/auth.service.ts` | Session bootstrap, login/logout, current-user signal |
| `src/app/service/project.service.ts` | Active-project state and CRUD |
| `src/app/service/workbench-storage.service.ts` | localStorage persistence of the active project / workbench |
| `src/app/core/guards/` | `auth.guard.ts` (require login) / `guest.guard.ts` (block when logged in) |
| `src/app/core/interceptors/auth.interceptor.ts` | Attaches the CSRF token; handles auth errors |
| `src/app/models/` | TypeScript interfaces mirroring backend models |
| `src/app/core/directives/select-on-tab.ts` | Confirms autocomplete option on Tab |
| `src/app/shared/directives/focus-next.ts` | Advances focus to next field on Enter/selection |

### Data Flow

1. Autocomplete fields (species, ringing station, scientist) use `valueChanges → debounceTime(300) → switchMap` to hit the API.
2. Selecting a species pre-fills `ring_size` from `species.ring_size`.
3. When `ring_size` + `BirdStatus.FirstCatch` are both set, the next ring number is fetched automatically via an Angular `effect()`.
4. On submit, `transformFromForm()` flattens nested objects to flat IDs before POSTing or PUTting.
5. After a successful save, `cleanReset()` resets all fields except `ringing_station` and `staff`. (The Projekt is not a form field — it lives on the project signal and survives automatically; the organization derives from `currentProject().organization`.)

### Angular Conventions

Canonical guidance lives in [`frontend/LLM.md`](frontend/LLM.md) (standalone components, signals, `input()`/`output()`, `OnPush`, native control flow, `inject()`, reactive forms).

### Locale

`LOCALE_ID: 'de-AT'` (Austrian German). All date and float formatting must use Austrian German conventions.

### Keyboard UX

`SelectOnTabDirective` confirms the highlighted autocomplete option on Tab and advances focus. Single-character shortcuts (the `key` property of `SelectOption`) are mapped to enum values for `MatSelect` fields, then `focusNext()` advances through `focusOrder`.

## Subsystems

**Auth** — Session-based (Django `SessionAuthentication`) with CSRF. The app bootstraps the session via `GET /api/auth/me/` before routing; `authGuard` redirects unauthenticated users to `/login`, `guestGuard` keeps logged-in users off it. `auth.interceptor.ts` attaches the CSRF token to mutating requests. Login/logout hit `/api/auth/login/` and `/api/auth/logout/`.

**Project management** — Captures are scoped to a Projekt. `HomeComponent` is the hub for creating, editing, and switching projects (`ProjectService`); the active project is persisted to `localStorage` by `WorkbenchStorageService` so it survives reloads, and it scopes ring-number suggestions, species ordering, and the IWM export.

**Exports** — Two paths: the per-project IWM `.xlsx` workbook via `GET /api/birds/projects/{id}/export-iwm/` (`iwm_export.py`, format reproduced from the reference sheet cited in ADR 0002), and a Django-admin "Als CSV exportieren" bulk action on `DataEntry`.
