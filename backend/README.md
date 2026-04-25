# BirdDoc

Django REST API backend for a bird ringing (ornithology) data capture system. Pairs with an Angular 20 frontend at `localhost:4200`.

## Stack

- Python 3.13 / Django 5.2 / Django REST Framework 3.16
- SQLite (development)
- CORS open for `localhost:4200`

## Quick Start

```bash
pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver          # http://localhost:8000
```

### Load species data

```bash
python manage.py import_species res/artenliste_2024.csv
# Options: --clear (wipe first), --no-other (skip "Andere Art" catch-all)
```

## API Overview

All routes under `/api/birds/`. Pagination: 10 per page.

| Endpoint | Access | Notes |
|---|---|---|
| `GET/POST/PUT/DELETE /data-entries/` | Public | Core bird capture records |
| `GET /species/` | Public | ~1M rows — always search, never load all |
| `GET /rings/` | Public | All registered rings |
| `GET /rings/next-number?size=<V\|T\|S\|X\|P>` | Public | Returns `max(number) + 1` for that size |
| `GET /ringing-stations/` | Public | Searchable by name/handle |
| `GET /scientists/` | Public | Searchable by handle/name |
| `GET/POST/PUT/DELETE /species-lists/` | Authenticated | Per-user species filter lists |

## Key Behaviors

**Ring lifecycle** — Clients never POST to `/rings/`. Write a `DataEntry` with `ring_number` + `ring_size`; the serializer calls `_get_or_create_ring()`. When a DataEntry's ring changes, the orphaned Ring is deleted transactionally.

**Smart ring numbering** — `next-number` casts all existing numbers to `int` and returns `max + 1`, tolerating gaps and non-numeric values.

**Species filtering** — If the authenticated user has an active `SpeciesList`, `GET /species/` returns only those species. Unauthenticated requests get all species. Only one list per user can be `is_active=True` (enforced in `SpeciesList.save()`).

**DataEntry write vs. read shape** — Write uses flat fields (`species_id`, `staff_id`, `ringing_station_id`, `ring_number`, `ring_size`); read returns nested objects.

## Data Models

| Model | Key fields |
|---|---|
| `DataEntry` | Core record: species, ring, scientist, station, date/time, biometrics, moult stages, condition flags |
| `Ring` | `(size, number)` unique pair; sizes: V, T, S, X, P |
| `Species` | German/English/scientific names, family, recommended ring size |
| `Scientist` | OneToOne with User; `handle` (e.g. `MUS`) |
| `RingingStation` | `handle` as PK (e.g. `STAMT`), name |
| `SpeciesList` | Per-user M2M to Species; `is_active` filter toggle |

## Admin

Django admin at `/admin/` has full CRUD for all models.

`DataEntry` admin includes a **CSV export action** (`Beringungsdaten-<date>.csv`) with German headers and biometric + condition flag columns.
