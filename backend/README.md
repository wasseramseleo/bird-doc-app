# BirdDoc — Backend

Django REST API for a bird ringing (ornithology) data capture system. Part of the `bird-doc-app` monorepo — pairs with the Angular 20 frontend in `../frontend/` at `localhost:4200`.

## Stack

- Python 3.13 / Django 5.2 / Django REST Framework 3.16
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

### Load species data

```bash
uv run python manage.py import_species res/artenliste_2024.csv
# Options: --clear (wipe first), --no-other (skip "Andere Art" catch-all)
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
| `/rings/next-number?size=<V\|T\|S\|X\|P>` | GET | Returns `max(number) + 1` for that size |
| `/ringing-stations/` | GET | Searchable by name/handle; filterable by `organization` |
| `/scientists/` | GET | Searchable by handle/name |
| `/organizations/` | GET | Searchable by name/handle |
| `/projects/` | GET/POST/PUT/DELETE | Scoped to the requesting user's Beringer |
| `/species-lists/` | GET/POST/PUT/DELETE | Per-user species filter lists |

## Key Behaviors

**Ring lifecycle** — Clients never POST to `/rings/`. Write a `DataEntry` with `ring_number` + `ring_size`; the serializer calls `_get_or_create_ring()`. When a DataEntry's ring changes, the orphaned Ring is deleted transactionally.

**Smart ring numbering** — `next-number` casts all existing numbers to `int` and returns `max + 1`, tolerating gaps and non-numeric values.

**Species filtering** — If the authenticated user has an active `SpeciesList`, `GET /species/` returns only those species; otherwise it returns all species. The endpoint requires authentication either way. Only one list per user can be `is_active=True` (enforced in `SpeciesList.save()`).

**DataEntry write vs. read shape** — Write uses flat fields (`species_id`, `staff_id`, `ringing_station_id`, `ring_number`, `ring_size`); read returns nested objects.

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

`DataEntry` admin includes a **CSV export action** (`Beringungsdaten-<date>.csv`) with German headers and biometric + condition flag columns.
