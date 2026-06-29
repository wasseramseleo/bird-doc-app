---
status: accepted
---

# Public landing stays server-rendered Django over a shared brand layer

## Context

#68 introduced the public landing as a server-rendered **Django app** (apex
`birddoc.at`), kept distinct from the headless `/api` — the right home for the
unauthenticated flows it carries: Zugangscode registration, email verification,
password reset and invite-accept all do server-side, transactional, token-bearing
work, and #68 deliberately served them as plain web pages so they work without
loading the SPA (User Story 22).

But the landing **reinvented its own visual identity** instead of inheriting the
app's: a cool grey-green paper (`#f1f3ef`) against the app's warm cream
(`#F7F2E8`), system sans-serif instead of the app's **Lora + Inter**, and a
CSS-drawn `○` wordmark instead of the real logo. The app's design tokens are
plain CSS custom properties (`--bd-*` in `frontend/src/styles.scss`) plus two
Google fonts and one logo asset — i.e. framework-agnostic.

A follow-up PRD redesigns the landing to two audiences (individual Beringer;
organisations such as the Österreichische Vogelwarte) and asked whether the
landing should be re-platformed — to Angular + Material like the app, a
static-site generator, or Tailwind.

## Decision

Keep the landing **server-rendered Django**, and fix the misalignment with a
single **shared brand layer** rather than a shared framework:

- Extract the brand tokens (`--bd-*` palette + Lora/Inter + the logo asset) into
  one canonical source consumed by **both** the Angular app and the Django
  landing. The app and landing are separate build roots on separate subdomains
  (and the CDN is gone — ADR 0007), so the share is **source-time**, not runtime:
  one canonical token file with a parity check, not a cross-origin link.
- Author the marketing home with hand-written CSS over those tokens. The public
  surface is small (one marketing home + ~4 legal + ~4 auth-flow pages +
  lead forms); it does not warrant a build pipeline.
- Bilingual DE/EN on the marketing + lead-form surface via Django `i18n_patterns`
  (default DE); legal and the auth flows stay German (Austrian law; the app is
  `de-AT`).

The misalignment was never a framework problem — switching frameworks would not
have fixed it. A shared brand layer does, and it leaves the server-side auth/token
flows where they belong.

## Considered options

- **Angular + Material (a second SPA, or fold the landing into the app).**
  Rejected: Material reads as *app chrome*, not a marketing site; it ships a heavy
  SPA bundle to a reader; it needs Angular SSR to be crawlable for a page whose
  whole job is SEO/first paint; and it cannot host the Django form/token flows
  without rebuilding them as API + SPA routes — re-loading the SPA for
  unauthenticated onboarding, exactly what #68 avoided.
- **Static-site generator (Astro et al.) for marketing + legal.** Rejected: it
  cannot serve the Django auth forms, so the landing would split across two
  systems and two deploy artifacts, with the auth pages still needing their own
  styling.
- **Tailwind on top of Django.** Not rejected on the merits — a reasonable
  *authoring* convenience — but deferred: it adds a PostCSS/Tailwind build and a
  second toolchain to the backend that this small surface does not yet need. It
  can be adopted later without revisiting this decision.

## Consequences

- One brand source of truth; a parity check guards against the app and landing
  drifting apart again (the very failure this ADR corrects).
- The auth/token flows stay native Django and unauthenticated visitors never load
  the SPA — SEO and first paint stay optimal for a public marketing page.
- The cost is two CSS *consumption* points kept in sync (app build + Django
  static) — accepted, and cheaper than a shared framework.
- Login stays in the Angular SPA (#68); the landing links out to the app login.
  The marketing/lead EN copy carries an honest note that the app is currently
  German-only.
