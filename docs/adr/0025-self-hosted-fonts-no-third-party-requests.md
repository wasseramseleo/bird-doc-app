---
status: accepted
---

# Fonts are self-hosted; no user-facing surface makes third-party requests

## Context

The Datenschutzerklärung claims BirdDoc uses "keine Dienste von Drittanbietern"
and therefore needs no cookie banner — and ADR 0007 sells "data stays in
Austria/EU" as both DSGVO posture and marketing asset. Yet both the Angular app
and the server-rendered landing (including the legal pages themselves) loaded
Lora, Inter and Material Icons from Google's CDN (`fonts.googleapis.com` /
`fonts.gstatic.com`), sending every visitor's IP address to Google — the exact
pattern the LG München Google-Fonts judgment found unlawful without consent.

The alternative was to keep the CDN and disclose Google (US transfer) in the
Datenschutzerklärung, permanently weakening the no-third-parties claim.

## Decision

All fonts are **self-hosted**; no user-facing surface makes any request to a
third-party host.

- **SPA**: `@fontsource/inter`, `@fontsource/lora` and `material-icons` are
  npm dependencies, bundled via the `styles` array in `angular.json`.
- **Landing**: the latin/latin-ext woff2 subsets are vendored under
  `backend/landing/static/landing/fonts/` with `landing/fonts.css` declaring
  the `@font-face` rules (values taken verbatim from @fontsource).
- `backend/landing/tests/test_legal.py` asserts that no public page references
  `fonts.googleapis.com` / `fonts.gstatic.com` (alongside the existing
  tracker blocklist).

## Consequences

- The Datenschutzerklärung's "keine Dienste von Drittanbietern — auch
  Schriften werden selbst gehostet" sentence is a **published legal claim**
  that depends on this ADR: adding any CDN-loaded resource (font, script,
  image, analytics) to a user-facing page silently falsifies it. The test
  guards the landing; the SPA has no equivalent guard — adding one is cheap if
  regressions appear.
- Font updates no longer arrive automatically; bumping the @fontsource
  packages (and re-copying the landing woff2 files) is a manual, rare chore.
- The landing vendors ~250 KB of woff2 into the repo — accepted; it keeps the
  script-free landing (ADR 0009) free of a node build step.
