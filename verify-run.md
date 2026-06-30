# Verify-run: PRD #68 and PRD #100

**Date:** 2026-06-30
**Branch:** `feedback-impl`
**Goal:** Verify that every change specified by PRD #68 (Public Beta — multi-tenancy,
gated onboarding, landing & go-public foundations) and PRD #100 (Landing-Redesign —
two-group landing, shared brand layer, DE/EN) actually landed in the codebase, and
fix all gaps.

## Method

Both PRDs are tracked as parent issues with child implementation issues:

- **#68** → children **#69–#84**
- **#100** → children **#101–#108**

Each child issue's acceptance criteria were verified **against the real code**, not
against commit messages. The verification was run as a fan-out of one rigorous
verifier per child issue (26 in total, including two PRD-level cross-cutting checks),
followed by an **adversarial refutation pass**: every claimed gap was independently
re-checked by a second agent whose job was to *refute* it (find where it is actually
implemented, or show it is operational/out-of-scope). Only gaps that survived
refutation were acted on.

Baselines captured before fixing:

- Backend: `uv run pytest` → **380 passed**
- Backend lint/format: `ruff check` clean, `ruff format --check` clean
- Migrations: `makemigrations --check` → no changes (complete)
- Frontend: `ng test` → **155 specs passed**; `ng build --configuration production` → success

## Result summary

| Issue | Area | Verdict |
|------:|------|---------|
| #69 | Tenancy spine (Mitgliedschaft, org-scoped captures, 2-tenant harness) | ✅ landed |
| #70 | Email as login identifier (ADR 0008) | ✅ landed |
| #71 | Landing Django app scaffold (apex) | ✅ landed |
| #72 | SPA Beta badge + first-login banner | ✅ landed |
| #73 | Production settings hardening | ✅ landed |
| #74 | Tenant isolation across all endpoints | ✅ landed |
| #75 | Ring scoped to Organisation (ADR 0006) | ✅ landed |
| #76 | Rollen authorization (Admin vs Mitglied) | ✅ landed |
| #77 | Transactional email + password reset | ✅ landed |
| #78 | Legal pages + beta/pricing content | ⚠️ **gap fixed** (AGB/DPA acceptance) |
| #79 | Zugangscode-gated registration | ✅ landed |
| #80 | Warteliste | ✅ landed |
| #81 | In-app Feedback form | ✅ landed |
| #82 | Cutover transform migration | ✅ landed |
| #83 | Org-Einladung + member management | ✅ landed |
| #84 | Go-live on IPAX VPS | ☑️ operational (repo artifacts present; see below) |
| #101 | Shared brand layer + CI parity guard | ✅ landed |
| #102 | Re-skin auth + legal pages | ✅ landed |
| #103 | Typed lead pipeline (Warteliste + Gespräch) | ✅ landed |
| #104 | Marketing home dual-track IA | ✅ landed |
| #105 | Org track trust narrative + Gespräch CTA | ✅ landed |
| #106 | Hero Fang-Karte + Ringserie thread | ✅ landed |
| #107 | Bilingual DE/EN | ✅ landed |
| #108 | SEO / Open Graph / share baseline | ✅ landed |
| #68 (cross-cutting) | ADRs, CONTEXT, Species global, beta_cohort durable, seats | ✅ landed (one doc nit fixed) |
| #100 (cross-cutting) | ADR 0009, CONTEXT sharpening, parity in CI, i18n coverage | ✅ landed |

**24 of 26 fully landed.** One real functional gap (#78) and one documentation nit
(#68) were found and fixed; #84 is operational and out of code scope.

## Gaps found and fixed

### 1. #78 — Org founding did not require/record AGB + DPA acceptance (functional, fixed)

PRD #68 User Story 51 and issue #78 require: *"Org founding requires accepting the
AGB + DPA."* The founding flow had **no acceptance step**: `RegistrationForm` had no
acceptance field, `register.html` neither linked to nor mentioned the AGB, and nothing
was recorded on the `Organization`. The AGB template only claimed *implicit* acceptance
("Mit der Gründung erkennt die gründende Person diese AGB … an"). This was deferred from
#78 to #79 and then never wired in #79 — it fell through the cracks.

**Fix:**

- `landing/forms.py`: added a **required** `accept_agb` `BooleanField` to
  `RegistrationForm`, with a clear German error message and a label that links to the
  AGB page (which carries the DPA appendix at `#dpa`). An unchecked box now blocks
  founding entirely.
- `birds/models.py`: added a durable `Organization.agb_accepted_at` `DateTimeField`
  (nullable — legacy/cutover-migrated orgs predate this gate).
- `birds/registration.py`: `register_organisation` now stamps `agb_accepted_at` at
  the moment of org creation (reaching that transactional door means the founder
  ticked the box).
- `birds/admin.py`: `OrganizationAdmin` surfaces `agb_accepted_at` (read-only) so the
  operator can see acceptance.
- `birds/migrations/0051_organization_agb_accepted_at.py`: schema migration.
- `landing/tests/test_registration.py`: the shared form-data helper now ticks the box;
  added three tests — the page offers the acceptance with an AGB link, acceptance is
  recorded on success, and founding is rejected (creating nothing, code unspent, no
  mail) when the box is unchecked.

### 2. #68 — ARCHITECTURE.md Models/Endpoints tables stale w.r.t. tenancy (doc, fixed)

The PRD only mandated rewriting the **Deployment Topology** section of `ARCHITECTURE.md`
(done). But the **Models** and **API Endpoints** tables still described the pre-tenancy
world: `Ring` as `(size, number)`-unique, `Organization` without its tenant/monetisation
fields, no `Mitgliedschaft`/`Zugangscode`/`OrgEinladung`/`Warteliste` rows, and endpoints
with no mention of per-Organisation scoping.

**Fix:** Refreshed both tables in `ARCHITECTURE.md` — `Ring` is now
`(organisation, size, number)`; `Organization` lists `plan`/`seat_limit`/`beta_cohort`/
`agb_accepted_at`; the four new tenancy models are listed; `Species` is annotated as
global; the endpoints table notes org-scoping (cross-tenant → 404), the Admin-only
writes, and the `/invitations/` + `/mitgliedschaften/` viewsets.

## Decisions & best guesses (documented per the task brief)

1. **AGB/DPA acceptance mechanism.** The PRD says acceptance happens "at org founding"
   but not *how*. Decision: a **required checkbox** on the registration form (blocks
   founding when unchecked) plus a **durable `agb_accepted_at` timestamp** on the
   controlling `Organization`. Rationale: the Organisation is the controller, so the
   acceptance record belongs on it; a timestamp is the minimal durable proof, mirrors
   the existing `used_at`/`beta_cohort` style, and needs no new model. The checkbox
   label links to the AGB page (DPA is its appendix), so one link covers both.

2. **`agb_accepted_at` is nullable.** Organisations created outside the gated flow —
   notably the cutover-migrated **IWM Linz** org (#82) — predate this gate and correctly
   carry `NULL`. Backfilling a fake acceptance timestamp would misrepresent consent, so
   it was deliberately left null for legacy rows.

3. **Domain pivot is intentional, not a gap.** PRD #68 names `birddoc.at` canonical with
   `.eu` redirecting and sender `noreply@birddoc.at`. The codebase makes **`birddoc.eu`
   canonical** (`.at` → 301) with sender `noreply@birddoc.eu`, per **ADR 0010** and commit
   `391af26`. This is a recorded later decision that supersedes the PRD text; verifiers
   flagged the difference and it was confirmed *not* a gap.

4. **Translation catalog.** The new `accept_agb` strings are German (the registration
   page is German-only — `GermanAuthFormMixin` forces German, per ADR 0009). Following
   the documented workflow (`makemessages … && compilemessages`), the catalog gained the
   3 new msgids with empty English msgstr (they render from the German source). The
   larger `django.po` diff is **pure line re-wrapping** by `makemessages` — verified that
   **zero existing translations changed** (parsed both catalogs into msgid→msgstr maps and
   diffed). The compiled `.mo` files are byte-identical (msgfmt omits empty translations),
   so there was nothing to recommit there.

5. **#84 is operational, not a code gap.** All repo-verifiable artifacts are present and
   mutually consistent: `Caddyfile`, `docker-compose.prod.yml`, `.github/workflows/deploy.yml`,
   `backend/.env.example`, the env-driven `settings.py`, `docs/deploy.md`, `deploy/bootstrap.sh`,
   and ADR 0007/0010. The remaining items (provisioning the real VPS, live DNS records,
   Brevo SMTP credentials, the scheduled maintenance window, the tested restore/rollback)
   are operational and not verifiable from the repo.

6. **Out-of-scope observation (not changed).** A legacy seed migration
   (`birds/migrations/0016_organization.py`) creates an `Organization` literally named
   "Vogelwarte Österreich", which sits in mild tension with CONTEXT.md's sharpened stance
   (a national authority is *not* an Organisation; no parent tier). This is a historical
   migration (rewriting it is unsafe and out of scope for both PRDs) and the cutover (#82)
   migrates live data into the "IWM Linz" org, so it has no functional impact. Noted only.

## Verification after fixes

- Backend: `uv run pytest` → **383 passed** (380 + 3 new registration tests)
- Backend lint/format: `ruff check` clean, `ruff format --check` clean
- Migrations: `makemigrations --check` → no changes (complete)
- Frontend: unchanged by these fixes — **155 specs** still pass, production build still succeeds
