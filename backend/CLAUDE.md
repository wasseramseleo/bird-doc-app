# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Django REST API backend for a bird ringing (ornithology) documentation system. It pairs with an Angular 20 frontend (separate repo) running on `localhost:4200`.

## Commands

```bash
# Install dependencies
pip install -r requirements.txt

# Apply migrations
python manage.py migrate

# Run development server (http://localhost:8000)
python manage.py runserver

# Create admin user
python manage.py createsuperuser

# Make new migrations after model changes
python manage.py makemigrations
```

There is no linting, formatting, or test suite currently configured.

## Architecture

**Single Django app** (`birds/`) with project config in `birddoc/`.

All API routes are under `/api/birds/` via DRF router in `birds/urls.py`. The six ViewSets map directly to the six models:

| Endpoint | Model | Access |
|---|---|---|
| `/data-entries/` | `DataEntry` | Full CRUD |
| `/species/` | `Species` | Read-only + search |
| `/rings/` | `Ring` | Read-only + `next-number` action |
| `/ringing-stations/` | `RingingStation` | Read-only + search |
| `/scientists/` | `Scientist` | Read-only + search |
| `/species-lists/` | `SpeciesList` | Full CRUD (per-user) |

### Key Non-Obvious Behaviors

**Ring lifecycle** — Rings are not created by the client directly. `DataEntrySerializer._get_or_create_ring()` handles creation/lookup on `DataEntry` save. When a `DataEntry` ring changes, the old `Ring` is deleted if no longer referenced (transactional cleanup in `serializers.py`).

**Smart ring numbering** — `GET /api/birds/rings/next-number?size=V` casts all ring numbers to integers and returns `max + 1`. This handles gaps and non-numeric values gracefully.

**Species filtering by user list** — `SpeciesViewSet.get_queryset()` checks if the authenticated user has an active `SpeciesList`; if so, it returns only those species. Unauthenticated requests get all species. Only one `SpeciesList` per user can be `active=True` (enforced in `SpeciesList.save()`).

**CSV export** — `DataEntryAdmin` includes a bulk export action that serializes biometric fields and appends boolean flags (mites, hunger stripes, brood patch, CPL+) as text into the comment column.

### Data Model Summary

`DataEntry` is the core model — one record per captured bird. It holds:
- FKs to `Species`, `Ring`, `Scientist` (staff), `RingingStation`
- Capture metadata: `date_time`, net location/height/direction
- Biometric measurements (all `DecimalField`): weight, wing span, feather length, tarsus
- Classification fields: age class, sex, fat deposit, muscle class
- Moult stages: small feathers, hand wing stages
- Boolean flags: mites, hunger stripes, brood patch, CPL+

`Ring` has a unique constraint on `(size, number)`. Sizes are: `V, T, S, X, P`.

`Species` is a large lookup table (~1M rows) loaded from a CSV migration. It carries the recommended ring size per species, which the frontend uses to pre-fill the ring size field.

### Settings Notes

`birddoc/settings.py` has `DEBUG=True` and a hardcoded `SECRET_KEY` — development only. CORS is open for `localhost:4200`. Pagination is page-based, 10 items per page.
