# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Django REST API backend for a bird ringing (ornithology) documentation system. It pairs with the Angular 21 frontend in `../frontend/` (same monorepo) running on `localhost:4200`.

## Commands

Dependencies are managed with `uv` (`pyproject.toml` + `uv.lock`); there is no `requirements.txt`.

```bash
# Install dependencies (incl. dev group: pytest, ruff)
uv sync

# Apply migrations
uv run python manage.py migrate

# Run development server (http://localhost:8000)
uv run python manage.py runserver

# Create admin user
uv run python manage.py createsuperuser

# Make new migrations after model changes
uv run python manage.py makemigrations

# Run the test suite (pytest + pytest-django)
uv run pytest

# Lint / format
uv run ruff check .
uv run ruff format .
```

Tests live in `birds/tests/` (one `test_*.py` per area), driven through the DRF HTTP API with shared fixtures in `birds/tests/conftest.py`. Lint config (`ruff`) and pytest config are in `pyproject.toml`.

## Architecture

**Single Django app** (`birds/`) with project config in `birddoc/`.

All API routes are under `/api/birds/` via DRF router in `birds/urls.py`. **The entire API requires authentication** — DRF defaults are `IsAuthenticated` with `SessionAuthentication` (`birddoc/settings.py`); there are no public endpoints. The eight ViewSets map directly to the eight models:

| Endpoint | Model | Access (all authenticated) |
|---|---|---|
| `/data-entries/` | `DataEntry` | Full CRUD |
| `/species/` | `Species` | Read-only + search |
| `/rings/` | `Ring` | Read-only + `next-number` action |
| `/ringing-stations/` | `RingingStation` | Read-only + search |
| `/scientists/` | `Scientist` | Read + search + authenticated create (ADR 0001); no edit/delete |
| `/species-lists/` | `SpeciesList` | Full CRUD (per-user) |
| `/organizations/` | `Organization` | Read-only + search |
| `/projects/` | `Project` | Full CRUD (scoped to the user's Beringer) |

### Key Non-Obvious Behaviors

**Ring lifecycle** — Rings are not created by the client directly. `DataEntrySerializer._get_or_create_ring()` handles creation/lookup on `DataEntry` save. When a `DataEntry` ring changes, the old `Ring` is deleted if no longer referenced (transactional cleanup in `serializers.py`).

**Smart ring numbering** — `GET /api/birds/rings/next-number?size=V&project=<uuid>` returns `{"next_number": <string> | null}`: the *last consumed* number on the rope **+ 1**, never `max + 1`. It takes the most recently created (`created`) `DataEntry` of that size in the given `project` that drew a fresh number from the rope — a first catch (`bird_status='e'`) **or** a destroyed-ring record (`species.special_kind == "ring_destroyed"`); recaptures (Wiederfang) consume nothing and are excluded, and the recording Beringer is irrelevant. The numeric value is incremented while leading-zero width is preserved (`0042` → `0043`, returned as a string). It returns `null` when the project has no qualifying capture of that size or the previous number is non-numeric — there is no global/other-project fallback (issues #22, #42).

**Species filtering by user list** — `SpeciesViewSet.get_queryset()` checks if the authenticated user has an active `SpeciesList`; if so, it returns only those species **plus the always-selectable Sonderart rows** (every `Species` whose `special_kind` is set — "Ring Vernichtet" and "Aves ignota"). An authenticated user without an active list gets all species (the endpoint itself still requires authentication). Only one `SpeciesList` per user can be `is_active=True` (enforced in `SpeciesList.save()`).

**Species ordering by usage frequency** — On top of filtering, `_order_by_usage()` (`views.py:97-110`) re-orders the candidate species by how often they are actually used — most-used first, alphabetically within ties. Usage is scoped to `?project` when that project has any entries, otherwise it falls back to a global count (mirrors the ring-number suggestion's project/global behavior, issue #27).

**Sonderart species** — non-taxon `Species` rows marked by a non-empty `special_kind` discriminator (replaces the former `is_sentinel` boolean; see ADR 0004). Two kinds: `"ring_destroyed"` ("Ring Vernichtet") and `"unknown_species"` ("Aves ignota"). `DataEntrySerializer._null_bird_data_for_destroyed_ring()` forces **every** bird-data field to `null` when the chosen species is `ring_destroyed`, regardless of what the client sent (Ring, Beringer, Station and Datum stay required — it still consumes a rope number). For `unknown_species`, the form stays full but `DataEntrySerializer.validate()` rejects a blank `comment` (the Bemerkung is mandatory). The model and admin stay unconstrained for data repair.

**Projects scoped to the user's Beringer** — `ProjectViewSet.get_queryset()` (`views.py:224-233`) returns `Project.objects.none()` — an **empty list, not a 403** — when the requesting user has no linked `Scientist` (Beringer). Authenticated users without a Beringer simply see no projects.

**Write vs. read payload shape** — POST/PUT/PATCH to `/data-entries/` accept flat IDs (`species_id`, `staff_id`, `ringing_station_id`, `ring_number`, `ring_size`); GET returns nested objects. The two shapes are intentionally different — never feed a GET response body back as a write payload, and never POST to `/rings/` directly.

**CSV export** — `DataEntryAdmin` includes an "Als CSV exportieren" bulk action that serializes biometric fields and appends boolean flags (mites, hunger stripes, brood patch, CPL+) as text into the comment column. (Per-project IWM `.xlsx` export is a separate path — `GET /projects/{id}/export-iwm/`, `iwm_export.py`.)

### Data Model Summary

`DataEntry` is the core model — one record per captured bird. It holds:
- FKs to `Species`, `Ring`, `Scientist` (staff), `RingingStation`
- Capture metadata: `date_time`, net location/height/direction
- Biometric measurements (all `DecimalField`): weight, wing span, feather length, tarsus
- Classification fields: age class, sex, fat deposit, muscle class
- Moult stages: small feathers, hand wing stages
- Boolean flags: mites, hunger stripes, brood patch, CPL+

`Ring` has a unique constraint on `(size, number)`. Sizes are the full Austrian scheme (`Ring.RingSizes`: `AS, BS, C, D, DS, DA, F, FA, G, GA, H, HA, K, KA, L, LA, M, N, NA, P, PA, R, S, SA, T, TA, V, X`); the frontend currently surfaces the common subset `V, T, S, X, P`.

`Species` is a large lookup table (~1M rows) loaded from a CSV migration. It carries the recommended ring size per species, which the frontend uses to pre-fill the ring size field.

### Settings Notes

`birddoc/settings.py` is env-driven (`django-environ`, see `.env.example`) and **hardened for a public deployment** (issue #73). Dev stays zero-config — `DJANGO_DEBUG` defaults to `False`, but a local `.env` sets it `true`, where `SECRET_KEY` falls back to the insecure dev default, CORS/CSRF default to `http://localhost:4200`, email prints to the console, and the session cookie is host-only.

In production (`DJANGO_DEBUG=False`) the app **fails loudly at startup** unless `DJANGO_SECRET_KEY` is a real, non-`django-insecure-` secret — there is no insecure default reachable in prod. The fail-loud policy lives in `birddoc/conf.py::resolve_secret_key` (unit-tested directly) and is wired into `settings.py`. `DJANGO_ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS` and `DJANGO_SESSION_COOKIE_DOMAIN` are env-driven (prod points them at `app.birddoc.at` / `birddoc.at`); `SESSION_COOKIE_DOMAIN=app.birddoc.at` lets the SPA and `/admin` share one session. Cookies are `Secure` whenever `DEBUG` is off. Pagination is page-based, 10 items per page.

The test suite runs against `birddoc/settings_test.py` (set via `DJANGO_SETTINGS_MODULE` in `pyproject.toml`), which injects a throwaway non-insecure `SECRET_KEY` before importing the real settings — pytest-django imports settings too early for a `conftest.py` to do this. Behaviour is covered in `birds/tests/test_settings.py`.
