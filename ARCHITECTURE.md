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

Hosted on an **IPAX VPS** (Debian 13, Austrian/EU data residency) with a public IP. Cloudflare and Tailscale are gone (ADR 0007): Caddy terminates TLS itself via Let's Encrypt, and deploy reaches the box over public SSH. The full runbook is [`docs/deploy.md`](docs/deploy.md).

```
                        Internet
                           │ HTTPS (HTTP/1.1, /2, /3)
                           ▼
                  DNS A records → VPS public IP
                           │
        ┌────────────── IPAX VPS (Debian 13) ──────────────┐
        │  ufw: 22 (SSH) · 80/443 (HTTP/S)                 │
        │                                                  │
        │  Caddy  :80/:443  (Let's Encrypt; public ingress)│
        │   ├─ birddoc.eu        ─┬─▶ /static/*  → /srv/staticfiles
        │   │   (apex, landing)   └─▶ /          → backend:8000  (Django landing)
        │   │                                                   (gunicorn, UID 1001)
        │   ├─ app.birddoc.eu    ─┬─▶ /api/*, /admin/*  → backend:8000
        │   │   (SPA + API)       ├─▶ /static/*         → /srv/staticfiles
        │   │                     └─▶ /                 → frontend:80  (nginx + Angular)
        │   └─ birddoc.at, app.birddoc.at ─▶ 301 → .eu canonical
        │                                          │
        │                                          ▼
        │                                Postgres 16 (host bind /opt/bird-doc-app/pgdata)
        └──────────────────────────────────────────────────┘
                            ▲
                            │ public SSH (key-only, firewalled)
              GitHub Actions runner ──▶ scp compose+Caddyfile ──▶ docker compose pull && up -d
```

- **Host-based routing.** Caddy splits by `Host`: the apex `birddoc.eu` serves the server-rendered Django landing (ADR 0009); `app.birddoc.eu` serves the Angular SPA at `/` with `/api` + `/admin` proxied to the same gunicorn. The landing and the API are one Django process, separated only by host + URL prefix. `birddoc.at` and `app.birddoc.at` 301-redirect to their `.eu` counterparts (path + query preserved).
- **TLS is the VPS's responsibility.** Caddy obtains and renews a Let's Encrypt certificate per hostname over the HTTP-01 challenge, so ports 80 and 443 must stay publicly reachable. No edge cache or WAF (accepted at beta scale — ADR 0007).
- **Deploy is public SSH.** `SSH_HOST` in GitHub secrets is the VPS IP/DNS; auth is key-only and the firewall (ufw) limits exposure to 22/80/443.
- `staticfiles` is a named docker volume shared read-only into Caddy; it is seeded by `collectstatic` on every backend start.

## Backend (`backend/`)

**Stack:** Python 3.13, Django 5.2 (`>=5.2,<5.3`), Django REST Framework 3.16 (`>=3.16,<4`), SQLite (dev) / Postgres (prod)

Single Django app (`birds/`) with project config in `birddoc/`. All routes are under `/api/birds/` via a DRF `DefaultRouter`.

### Models

| Model | Role |
|-------|------|
| `DataEntry` | Core record — one row per captured bird; owned by an `Organization` (tenant — ADR 0005) |
| `Ring` | Unique `(organisation, size, number)` — org-scoped (ADR 0006); full Austrian size scheme (frontend surfaces `V T S X P`) |
| `Species` | ~1M-row lookup table with recommended ring size; **global** reference data, *not* tenant-scoped |
| `Scientist` | The Beringer; account-independent (nullable User FK — ADR 0001), org-owned, identified by `handle` (e.g. `MUS`) |
| `RingingStation` | `handle` as PK (e.g. `STAMT`), name, belongs to an `Organization` |
| `Organization` | The **tenant** (ADR 0005); `handle` as PK; carries `plan` / `seat_limit` / `beta_cohort` / `agb_accepted_at` |
| `Project` | Named campaign scoped to one `Organization` and a set of `Scientist` |
| `SpeciesList` | Per-user M2M to Species for filtering |
| `Mitgliedschaft` | Account ↔ `Organization` membership with a `Rolle` (`Admin` / `Mitglied`) — the tenancy spine (ADR 0005) |
| `Zugangscode` | Single-use, operator-issued code gating org founding (ADR 0005) |
| `OrgEinladung` | Email invitation of a Mitglied into an Organisation, capped by the Seat-Limit (issue #83) |
| `Warteliste` | Public lead — Beringer Warteliste / Organisation Gespräch, typed discriminator (issues #80, #103) |

### API Endpoints

**The entire API requires authentication** — DRF defaults are `IsAuthenticated` + `SessionAuthentication` (`birddoc/settings.py`). The one public endpoint is the server-rendered Org-Einladung accept view on the Landing app (issue #83); the "Access" column below describes the shape, not the auth level. **Every collection is org-scoped to the requester's Organisation(s)** (ADR 0005, issue #74): a cross-tenant detail fetch or write returns **404** (the row is absent from the scoped queryset), and `Admin`-only writes by a same-tenant Mitglied return **403** (issue #76). `Species` is the sole exception — global reference data.

| Endpoint | Access | Notes |
|----------|--------|-------|
| `/data-entries/` | CRUD | Core capture records, **org-scoped** to the active Organisation; filter by `?project`, or `?ring_size` + `?ring_number` |
| `/species/` | Read + search | **Global** (not tenant-scoped); narrowed to the user's active SpeciesList when one exists; ordered by per-project usage frequency (`?project`) |
| `/rings/` | Read | Org-scoped to the active Organisation (ADR 0006) |
| `/rings/next-number?size=<size>&project=<id>` | Read | "Last consumed + 1" for that size in the project, org-scoped (see below) |
| `/ringing-stations/` | Read + search | Org-scoped; create/edit/delete **Admin-only** (issue #76) |
| `/scientists/` | Read + **Create** | Org-scoped; authenticated create — a Beringer can be added mid-session (ADR 0001); no edit/delete |
| `/organizations/` | Read + search | Scoped to the requester's Mitgliedschaften; edit **Admin-only** (issue #76) |
| `/projects/` | CRUD | Scoped to the requesting user's Beringer (org-isolating); create/edit/delete + IWM export **Admin-only** (issue #76) |
| `/projects/{id}/export-iwm/` | Read | **Admin-only**; streams the project's captures as an IWM `.xlsx` workbook |
| `/species-lists/` | CRUD | Per-user species filter lists |
| `/invitations/` | **Admin-only** CRUD | Org-Einladung — invite a Mitglied by email, capped by the Seat-Limit; mails a public accept link (issue #83) |
| `/mitgliedschaften/` | **Admin-only** | Member management — list/retrieve/`PATCH` Rolle/remove; the last Admin is protected (issue #83) |

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
