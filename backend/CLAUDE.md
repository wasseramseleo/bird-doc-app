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

All API routes are under `/api/birds/` via DRF router in `birds/urls.py`. **The entire API requires authentication** — DRF defaults are `IsAuthenticated` with `SessionAuthentication` (`birddoc/settings.py`); there are no public endpoints (the one exception is the server-rendered Org-Einladung accept view on the Landing app — issue #83). The ViewSets map to the models:

| Endpoint | Model | Access (all authenticated) |
|---|---|---|
| `/data-entries/` | `DataEntry` | Full CRUD for any Mitglied (scoped to the active Organisation — ADR 0005) |
| `/species/` | `Species` | Read-only + search |
| `/rings/` | `Ring` | Read-only + `next-number` action (scoped to the active Organisation — ADR 0006) |
| `/ringing-stations/` | `RingingStation` | Read + search for any Mitglied (scoped to the active Organisation — ADR 0005); create/edit/delete **Admin-only** (issue #76) |
| `/scientists/` | `Scientist` | Read + search + authenticated create (ADR 0001; scoped to the active Organisation — ADR 0005); no edit/delete (deletion is Admin-only via Django admin — ADR 0003) |
| `/species-lists/` | `SpeciesList` | Full CRUD (per-user) |
| `/organizations/` | `Organization` | Read + search (scoped to the requester's Mitgliedschaften — ADR 0005); edit **Admin-only**, no create/delete (issue #76) |
| `/projects/` | `Project` | Read for any Mitglied (scoped to the user's Beringer; create attaches to the active Organisation — ADR 0005); create/edit/delete and IWM export **Admin-only** (issue #76) |
| `/invitations/` | `OrgEinladung` | **Admin-only** create/list/destroy, scoped to the active Organisation (issue #83); create mails the invitee a public accept link, gated by the Seat-Limit |
| `/mitgliedschaften/` | `Mitgliedschaft` | **Admin-only** list/retrieve/`PATCH` Rolle/remove, scoped to the active Organisation (issue #83); the last Admin can be neither removed nor demoted |

### Key Non-Obvious Behaviors

**Org-Einladung & Seat-Limit (issue #83)** — An Admin grows their team inside an already-admitted Organisation by inviting a colleague by email (`POST /invitations/`); the invitee gets a transactional mail (issue #77) with a public accept link `…/einladung/<token>/`. This is **ungated by the operator but capped by the Seat-Limit** (ADR 0005) — distinct from the org-founding Zugangscode. Seat accounting lives in `birds/invitations.py::seats_used` = **Mitgliedschaften + pending (un-accepted) Einladungen**: a pending invite *reserves* the seat it will fill, so ten invites cannot all accept against one free seat; **no-account Beringer consume none**. An over-limit invite is refused with a **409** (`SeatLimitReached`, a clear German `detail`); an already-member or duplicate-pending invite is a **400**. The accept view is **server-rendered on the Landing app** (`landing/views.py::OrgEinladungAcceptView`, the API's one public surface): `accept_invitation` creates the account via `accounts.create_public_account` when the email is new (ADR 0008) — set-password form — or, for an email that already has an account, simply adds the Mitgliedschaft (one-click join, no password). Acceptance is idempotent and stamps `accepted_at`, which stops the invite reserving its seat. Member management (`/mitgliedschaften/`) is Admin-only and refuses to strip the Organisation of its last Admin (`LAST_ADMIN_MESSAGE`).

**Rolle authorization (Admin vs Mitglied)** — Structural management is **Admin**-only; capture work stays open to any **Mitglied** (ADR 0005, issue #76). `birds/permissions.py` turns the active Organisation's `Mitgliedschaft.Rolle` into two DRF permissions: `IsOrgAdminOrReadOnly` (reads open within the tenant, writes Admin-only) gates `ProjectViewSet`, `RingingStationViewSet` and `OrganizationViewSet`; `IsOrgAdmin` (Admin-only for every method) gates the IWM export action — a privileged GET that must not ride the read exemption. "Admin" means the requester's `active_organization` membership has `Rolle == Admin` (`is_org_admin()`). A refused Mitglied gets a clear German `detail` message (`ADMIN_ONLY_MESSAGE`), never a bare 403. Because reads are themselves tenant-scoped (ADR 0005, issue #74), a *cross-tenant* Station/Organisation write is a **404** (the row is absent from the scoped queryset), while a same-tenant write by a non-Admin is a **403**; `perform_create`/`perform_update` additionally refuse a Station whose Organisation is not the actor's own. Captures (`/data-entries/`), per-user SpeciesLists, and the no-account Beringer quick-add (`POST /scientists/`, ADR 0001) are deliberately **not** Rolle-gated — a plain Mitglied does all capture CRUD across the whole Organisation. Beringer deletion stays Admin-only via the Django admin (no API delete — ADR 0003) and reassigns captures to the `GELÖSCHT` fallback at the model layer.

**Ring lifecycle** — Rings are not created by the client directly. `DataEntrySerializer._get_or_create_ring()` handles creation/lookup on `DataEntry` save, **scoped to the recording Organisation** (ADR 0006): the lookup keys on `(organization, size, number)`, so recording a number another Organisation owns creates a *new* `Ring` in the recording Organisation rather than reusing the other's. When a `DataEntry` ring changes, the old `Ring` is deleted if no longer referenced (transactional cleanup in `serializers.py`).

**Smart ring numbering** — `GET /api/birds/rings/next-number?size=V&project=<uuid>` returns `{"next_number": <string> | null}`: the *last consumed* number on the rope **+ 1**, never `max + 1`. It takes the most recently created (`created`) `DataEntry` of that size in the given `project` that drew a fresh number from the rope — a first catch (`bird_status='e'`) **or** a destroyed-ring record (`species.special_kind == "ring_destroyed"`); recaptures (Wiederfang) consume nothing and are excluded, and the recording Beringer is irrelevant. The whole computation is **scoped to the requester's active Organisation** (ADR 0006) — another Organisation's consumption of the same size never drives it, and an account with no active Organisation gets `null`. The numeric value is incremented while leading-zero width is preserved (`0042` → `0043`, returned as a string). It returns `null` when the Organisation/project has no qualifying capture of that size or the previous number is non-numeric — there is no global/other-project fallback (issues #22, #42).

**Species filtering by user list** — `SpeciesViewSet.get_queryset()` checks if the authenticated user has an active `SpeciesList`; if so, it returns only those species **plus the always-selectable Sonderart rows** (every `Species` whose `special_kind` is set — "Ring Vernichtet" and "Aves ignota"). An authenticated user without an active list gets all species (the endpoint itself still requires authentication). Only one `SpeciesList` per user can be `is_active=True` (enforced in `SpeciesList.save()`).

**Species ordering by usage frequency** — On top of filtering, `_order_by_usage()` (`views.py:97-110`) re-orders the candidate species by how often they are actually used — most-used first, alphabetically within ties. Usage is scoped to `?project` when that project has any entries, otherwise it falls back to a global count (mirrors the ring-number suggestion's project/global behavior, issue #27).

**Sonderart species** — non-taxon `Species` rows marked by a non-empty `special_kind` discriminator (replaces the former `is_sentinel` boolean; see ADR 0004). Two kinds: `"ring_destroyed"` ("Ring Vernichtet") and `"unknown_species"` ("Aves ignota"). `DataEntrySerializer._null_bird_data_for_destroyed_ring()` forces **every** bird-data field to `null` when the chosen species is `ring_destroyed`, regardless of what the client sent (Ring, Beringer, Station and Datum stay required — it still consumes a rope number). For `unknown_species`, the form stays full but `DataEntrySerializer.validate()` rejects a blank `comment` (the Bemerkung is mandatory). The model and admin stay unconstrained for data repair.

**Projects scoped to the user's Beringer** — `ProjectViewSet.get_queryset()` returns `Project.objects.none()` — an **empty list, not a 403** — when the requesting user has no linked `Scientist` (Beringer). Authenticated users without a Beringer simply see no projects. The per-Beringer filter is itself tenant-isolating (a Beringer is org-owned), so a cross-tenant Projekt is absent from the queryset and a detail/write against it is a **404**. `perform_create()` attaches the new Projekt to the requester's **active Organisation** server-side — a client-supplied `organization_id` cannot plant a Projekt in another tenant (it is now optional and overridden) — and **refuses (403)** when there is no active Organisation. `ProjectSerializer._effective_organization()` resolves the org authoritatively (active org on create, instance org on update) so the `default_station` org-match check runs against the org the Projekt will actually belong to (issue #74).

**The other collection endpoints are org-scoped too (tenant boundary — issue #74)** — `RingingStationViewSet`, `ScientistViewSet` and `OrganizationViewSet` all scope to the requester's tenant via `birds/tenancy.py:active_organization()`, mirroring captures: a cross-tenant detail fetch is a **404** (the row is absent from the queryset), not a 403, and no active Organisation ⇒ an empty list. Stationen and Beringer filter to the **active Organisation**; the Beringer autocomplete shows only own-Organisation Beringer (Mitglieder + No-Account) and still excludes the org-less `GELÖSCHT` fallback, and a quick-added Beringer attaches to the active Organisation (`ScientistViewSet.perform_create`, refuses 403 without one). Organisations scope to the requester's **Mitgliedschaften** (so a multi-org account still sees each of its orgs). `Rings` are scoped too (ADR 0006 — `RingViewSet.get_queryset()` filters to the active Organisation; see *Ring lifecycle* above), while `Species` stays **global** reference data — explicitly *not* tenant-scoped. The org-attaching creates share `views.py:_require_active_organization()`.

**Captures scoped to the active Organisation (tenant boundary)** — The Organisation is the tenant (ADR 0005). `DataEntryViewSet.get_queryset()` filters to the requester's **active Organisation** (`birds/tenancy.py:active_organization()` — the org of the account's single `Mitgliedschaft`; `None` when there are zero or several memberships, the latter awaiting the deferred org-switcher). No active Organisation ⇒ `DataEntry.objects.none()` (empty, not a 403, mirroring projects). A cross-tenant detail/write is therefore a **404** (the row is absent from the queryset), never a 403. `perform_create()` attaches each new capture to the active Organisation and **refuses (403)** when there is none. `DataEntry.organization` is the source of truth; `DataEntry.save()` falls back to `ringing_station.organization` when it is left unset (admin/ORM paths), so every capture is org-owned.

**Email login (ADR 0008)** — login is email-first **without** a custom user model. A public account stores its normalised (lowercased) email as both `username` and `email` — create them via `accounts.create_public_account(email, password)`, which enforces uniqueness off the existing `User.username` constraint (raising `EmailAlreadyExistsError` on a case-insensitive duplicate). `EmailOrUsernameModelBackend` (wired in `AUTHENTICATION_BACKENDS` after the stock `ModelBackend`) resolves a login by email or username **case-insensitively**, so legacy username accounts (e.g. `filip`) keep their exact-username login unchanged. `login_view` is untouched — it still calls `authenticate(username=…, password=…)`; the SPA just relabels the field to E-Mail and submits the same `username` key.

**Zugangscode-gated registration (#79, ADR 0005)** — founding an Organisation is gated by a single-use `Zugangscode` the operator issues in the Django admin. The public, server-rendered registration lives on the **landing** app (`landing/views.py::RegisterView`, mirroring the password-reset flow — no DRF, no SPA), but the transactional creation is `birds/registration.py::register_organisation()`: in one `transaction.atomic()` it locks-and-checks the code (`select_for_update`, rejected **before anything is created** if unknown or used), then creates the founder `User` (**`is_active=False`** — strict double opt-in), their Beringer (`Scientist`), the `Organisation` (`plan=beta`, durable `beta_cohort=True`, unique slugified `handle`) and an **Admin** `Mitgliedschaft`, and stamps the code's `used_at`/`founded_organization`. A used code can never found a second Organisation. The view emails a verification link (`default_token_generator` + `uidb64`, `landing:register_verify`); following it flips `is_active=True` — until then the auth backend refuses login (ADR 0008), so verification gates sign-in. The post-register page points the founder at `settings.APP_LOGIN_URL` (the SPA login). Forms render under the German catalog via `GermanAuthFormMixin`.

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

`Ring` is scoped to the Organisation (ADR 0006): it carries a nullable `organization` FK (nullable only as a migration safety net for legacy rows) and a unique constraint on `(organization, size, number)`, so two Organisations may each own the same `(size, number)`. Sizes are the full Austrian scheme (`Ring.RingSizes`: `AS, BS, C, D, DS, DA, F, FA, G, GA, H, HA, K, KA, L, LA, M, N, NA, P, PA, R, S, SA, T, TA, V, X`); the frontend currently surfaces the common subset `V, T, S, X, P`.

`Species` is a large lookup table (~1M rows) loaded from a CSV migration. It carries the recommended ring size per species, which the frontend uses to pre-fill the ring size field.

`Organization` is the **tenant** (ADR 0005). It carries per-Organisation monetisation fields: `plan` (default `beta`), `seat_limit` (default 5), and a durable `beta_cohort` marker (separate from the mutable `plan`) — all editable in the Django admin. `Mitgliedschaft` links a Django `User` to an `Organization` with a `Rolle` (`Admin | Mitglied`); `unique_together(user, organization)` permits multiple memberships per account (multi-org) while forbidding a duplicate within one Organisation. `Scientist` (Beringer) carries a nullable `organization` FK — real Beringer (Mitglieder + no-account) are org-owned; only the reserved `GELÖSCHT` fallback sink stays org-less.

### Settings Notes

`birddoc/settings.py` is env-driven (`django-environ`, see `.env.example`) and **hardened for a public deployment** (issue #73). Dev stays zero-config — `DJANGO_DEBUG` defaults to `False`, but a local `.env` sets it `true`, where `SECRET_KEY` falls back to the insecure dev default, CORS/CSRF default to `http://localhost:4200`, email prints to the console, and the session cookie is host-only.

In production (`DJANGO_DEBUG=False`) the app **fails loudly at startup** unless `DJANGO_SECRET_KEY` is a real, non-`django-insecure-` secret — there is no insecure default reachable in prod. The fail-loud policy lives in `birddoc/conf.py::resolve_secret_key` (unit-tested directly) and is wired into `settings.py`. `DJANGO_ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS` and `DJANGO_SESSION_COOKIE_DOMAIN` are env-driven (prod points them at `app.birddoc.at` / `birddoc.at`); `SESSION_COOKIE_DOMAIN=app.birddoc.at` lets the SPA and `/admin` share one session. Cookies are `Secure` whenever `DEBUG` is off. Pagination is page-based, 10 items per page.

The test suite runs against `birddoc/settings_test.py` (set via `DJANGO_SETTINGS_MODULE` in `pyproject.toml`), which injects a throwaway non-insecure `SECRET_KEY` before importing the real settings — pytest-django imports settings too early for a `conftest.py` to do this. Behaviour is covered in `birds/tests/test_settings.py`.
