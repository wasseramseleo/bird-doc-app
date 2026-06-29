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
| `/data-entries/` | `DataEntry` | Full CRUD (scoped to the active Organisation — ADR 0005) |
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

**Captures scoped to the active Organisation (tenant boundary)** — The Organisation is the tenant (ADR 0005). `DataEntryViewSet.get_queryset()` filters to the requester's **active Organisation** (`birds/tenancy.py:active_organization()` — the org of the account's single `Mitgliedschaft`; `None` when there are zero or several memberships, the latter awaiting the deferred org-switcher). No active Organisation ⇒ `DataEntry.objects.none()` (empty, not a 403, mirroring projects). A cross-tenant detail/write is therefore a **404** (the row is absent from the queryset), never a 403. `perform_create()` attaches each new capture to the active Organisation and **refuses (403)** when there is none. `DataEntry.organization` is the source of truth; `DataEntry.save()` falls back to `ringing_station.organization` when it is left unset (admin/ORM paths), so every capture is org-owned. **This slice scopes the capture endpoint only** — `/rings/`, `/ringing-stations/`, `/scientists/`, `/projects/` follow in their own slices.

**Email login (ADR 0008)** — login is email-first **without** a custom user model. A public account stores its normalised (lowercased) email as both `username` and `email` — create them via `accounts.create_public_account(email, password)`, which enforces uniqueness off the existing `User.username` constraint (raising `EmailAlreadyExistsError` on a case-insensitive duplicate). `EmailOrUsernameModelBackend` (wired in `AUTHENTICATION_BACKENDS` after the stock `ModelBackend`) resolves a login by email or username **case-insensitively**, so legacy username accounts (e.g. `filip`) keep their exact-username login unchanged. `login_view` is untouched — it still calls `authenticate(username=…, password=…)`; the SPA just relabels the field to E-Mail and submits the same `username` key.

**Email login (ADR 0008)** — login is email-first **without** a custom user model. A public account stores its normalised (lowercased) email as both `username` and `email` — create them via `accounts.create_public_account(email, password)`, which enforces uniqueness off the existing `User.username` constraint (raising `EmailAlreadyExistsError` on a case-insensitive duplicate). `EmailOrUsernameModelBackend` (wired in `AUTHENTICATION_BACKENDS` after the stock `ModelBackend`) resolves a login by email or username **case-insensitively**, so legacy username accounts (e.g. `filip`) keep their exact-username login unchanged. `login_view` is untouched — it still calls `authenticate(username=…, password=…)`; the SPA just relabels the field to E-Mail and submits the same `username` key.

**Write vs. read payload shape** — POST/PUT/PATCH to `/data-entries/` accept flat IDs (`species_id`, `staff_id`, `ringing_station_id`, `ring_number`, `ring_size`); GET returns nested objects. The two shapes are intentionally different — never feed a GET response body back as a write payload, and never POST to `/rings/` directly.

**CSV export** — `DataEntryAdmin` includes an "Als CSV exportieren" bulk action that serializes biometric fields and appends boolean flags (mites, hunger stripes, brood patch, CPL+) as text into the comment column. (Per-project IWM `.xlsx` export is a separate path — `GET /projects/{id}/export-iwm/`, `iwm_export.py`.)

### Data Model Summary

`DataEntry` is the core model — one record per captured bird. It holds:
- FKs to `Species`, `Ring`, `Scientist` (staff), `RingingStation`, `Organization` (tenant owner)
- Capture metadata: `date_time`, net location/height/direction
- Biometric measurements (all `DecimalField`): weight, wing span, feather length, tarsus
- Classification fields: age class, sex, fat deposit, muscle class
- Moult stages: small feathers, hand wing stages
- Boolean flags: mites, hunger stripes, brood patch, CPL+

`Ring` has a unique constraint on `(size, number)`. Sizes are the full Austrian scheme (`Ring.RingSizes`: `AS, BS, C, D, DS, DA, F, FA, G, GA, H, HA, K, KA, L, LA, M, N, NA, P, PA, R, S, SA, T, TA, V, X`); the frontend currently surfaces the common subset `V, T, S, X, P`.

`Species` is a large lookup table (~1M rows) loaded from a CSV migration. It carries the recommended ring size per species, which the frontend uses to pre-fill the ring size field.

`Organization` is the **tenant** (ADR 0005). It carries per-Organisation monetisation fields: `plan` (default `beta`), `seat_limit` (default 5), and a durable `beta_cohort` marker (separate from the mutable `plan`) — all editable in the Django admin. `Mitgliedschaft` links a Django `User` to an `Organization` with a `Rolle` (`Admin | Mitglied`); `unique_together(user, organization)` permits multiple memberships per account (multi-org) while forbidding a duplicate within one Organisation. `Scientist` (Beringer) carries a nullable `organization` FK — real Beringer (Mitglieder + no-account) are org-owned; only the reserved `GELÖSCHT` fallback sink stays org-less.

### Settings Notes

`birddoc/settings.py` has `DEBUG=True` and a hardcoded `SECRET_KEY` — development only. CORS is open for `localhost:4200`. Pagination is page-based, 10 items per page.
