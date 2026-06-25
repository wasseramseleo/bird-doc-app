# BirdDoc — Backend

Django REST API for a bird ringing (ornithology) data capture system. Part of the `bird-doc-app` monorepo — pairs with the Angular 21 frontend in `../frontend/` at `localhost:4200`.

## Stack

- Python 3.13 / Django 5.2 (`>=5.2,<5.3`) / Django REST Framework 3.16 (`>=3.16,<4`)
- [uv](https://docs.astral.sh/uv/) for packaging + virtualenv management
- SQLite for native dev (default), Postgres in compose / production
- CORS / CSRF origins controlled via env

## Quick Start

```bash
cp .env.example .env                # adjust DJANGO_SECRET_KEY, etc.
uv sync                             # creates .venv from uv.lock
uv run python manage.py migrate
uv run python manage.py createsuperuser
uv run python manage.py runserver   # http://localhost:8000
```

`uv sync` installs runtime deps; the PEP 735 `dev` group (pytest, ruff) is included by default. Pass `--no-dev` to skip it.

### Tooling

```bash
uv run ruff check                   # lint
uv run ruff format                  # auto-format
uv run pytest                       # tests (no specs yet — exits 5)
```

### Management commands

```bash
uv run python manage.py import_species res/artenliste_2024.csv
# Load species reference data (required for autocomplete).
# Options: --clear (wipe first), --no-other (skip "Andere Art" catch-all)

uv run python manage.py create_test_data   # dev fixtures: users, projects, sample captures
uv run python manage.py seed_audit_data    # acceptance-test fixtures (see ADR 0001)
```

### Configuration

Environment variables (see `.env.example`):

| Var | Purpose |
|---|---|
| `DJANGO_SECRET_KEY` | Required in production |
| `DJANGO_DEBUG` | `true` for dev, `false` in prod |
| `DJANGO_ALLOWED_HOSTS` | Comma-separated hostnames |
| `DATABASE_URL` | Omit to fall back to local sqlite |
| `CORS_ALLOWED_ORIGINS` | Comma-separated frontend origins |
| `CSRF_TRUSTED_ORIGINS` | Comma-separated trusted origins |

## API Overview

All routes under `/api/birds/`. Pagination: 10 per page. **Every endpoint requires authentication** (`IsAuthenticated` + `SessionAuthentication`); there are no public routes.

| Endpoint | Methods | Notes |
|---|---|---|
| `/data-entries/` | GET/POST/PUT/DELETE | Core bird capture records |
| `/species/` | GET | ~1M rows — always search, never load all |
| `/rings/` | GET | All registered rings |
| `/rings/next-number?size=<V\|T\|S\|X\|P>&project=<id>` | GET | "Last consumed + 1" for that size in the project (see Key Behaviors) |
| `/ringing-stations/` | GET | Searchable by name/handle; filterable by `organization` |
| `/scientists/` | GET | Searchable by handle/name |
| `/organizations/` | GET | Searchable by name/handle |
| `/projects/` | GET/POST/PUT/DELETE | Scoped to the requesting user's Beringer |
| `/projects/{id}/export-iwm/` | GET | Streams the project's captures as an IWM `.xlsx` workbook |
| `/species-lists/` | GET/POST/PUT/DELETE | Per-user species filter lists |

## Key Behaviors

**Ring lifecycle** — Clients never POST to `/rings/`. Write a `DataEntry` with `ring_number` + `ring_size`; the serializer calls `_get_or_create_ring()`. When a DataEntry's ring changes, the orphaned Ring is deleted transactionally.

**Smart ring numbering** — `next-number` returns "last consumed + 1", **not** `max + 1`. It follows the project's most recent capture of that size that drew a fresh number from the rope — a first catch (Erstfang) **or** a destroyed-ring sentinel ("Ring vernichtet") record — ignoring recaptures (Wiederfänge), and increments it while preserving leading-zero width (`0042` → `0043`, returned as a string). Project-scoped; returns `null` when no qualifying capture exists or the previous number is non-numeric. See `CONTEXT.md` (Ringserie).

**Species filtering** — If the authenticated user has an active `SpeciesList`, `GET /species/` returns only those species; otherwise it returns all species. The endpoint requires authentication either way. Only one list per user can be `is_active=True` (enforced in `SpeciesList.save()`).

**DataEntry write vs. read shape** — Write uses flat fields (`species_id`, `staff_id`, `ringing_station_id`, `ring_number`, `ring_size`); read returns nested objects.

**Exports** — A project's captures export as an IWM `.xlsx` workbook via `GET /projects/{id}/export-iwm/` (`iwm_export.py`; format reproduced from the reference sheet cited in ADR 0002). Separately, the Django-admin `DataEntry` list has an **"Als CSV exportieren"** bulk action (see Admin below).

## Data Models

| Model | Key fields |
|---|---|
| `DataEntry` | Core record: species, ring, scientist, station, date/time, biometrics, moult stages, condition flags |
| `Ring` | `(size, number)` unique pair; full Austrian size scheme (frontend surfaces V, T, S, X, P) |
| `Species` | German/English/scientific names, family, recommended ring size |
| `Scientist` | The Beringer; OneToOne with User; `handle` (e.g. `MUS`) |
| `RingingStation` | `handle` as PK (e.g. `STAMT`), name; belongs to an `Organization` |
| `Organization` | Ringing scheme/body; `handle` as PK |
| `Project` | Named campaign scoped to one `Organization` and a set of `Scientist` |
| `SpeciesList` | Per-user M2M to Species; `is_active` filter toggle |

## Admin

Django admin at `/admin/` has full CRUD for all models.

`DataEntry` admin includes an **"Als CSV exportieren"** bulk action (`Beringungsdaten-<date>.csv`) with German headers and biometric + condition flag columns.
