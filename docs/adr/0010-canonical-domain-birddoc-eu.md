---
status: accepted
---

# Canonical domain is `birddoc.eu`, `birddoc.at` redirects

## Context

The public deployment (ADR 0007, ADR 0009) launched with **`birddoc.at` as the
canonical domain** — the apex served the Django landing, `app.birddoc.at` served
the SPA + `/api` + `/admin`, and the `.eu` hosts merely 301-redirected onto their
`.at` counterparts. `.at` reflected the product's Austrian origin and Austrian
(IPAX) hosting.

Adoption beyond Austria is now expected in the mid term (other countries'
ringing schemes / Vogelwarten). A country-specific `.at` apex is a weaker
canonical for a product courting an EU-wide audience: it bakes "Austria only"
into every canonical URL, sitemap entry, share card and sender address that
search engines and inboxes cache. `.eu` is the more neutral, durable home.

The application itself is already domain-agnostic — every canonical URL,
`robots.txt`, sitemap, OG tag and hreflang is built at request time from
`request.get_host()` / `build_absolute_uri()`. "Which domain is canonical" lives
only in the Caddy host routing, the email sender defaults, the deploy/env config
and the docs.

## Decision

Make **`birddoc.eu` the canonical domain** and reverse the redirect:

- Caddy serves the landing on apex `birddoc.eu` and the SPA + `/api` + `/admin`
  on `app.birddoc.eu`. `birddoc.at` and `app.birddoc.at` **301-redirect** to
  their `.eu` counterparts (path + query preserved) — the mirror of the prior
  setup.
- All transactional/operational mail moves to `.eu`: `noreply@birddoc.eu`
  (sender), `operator@birddoc.eu` (operator inbox + Caddy ACME contact), and the
  Impressum contact. Brevo sender-domain verification (SPF/DKIM/DMARC) re-runs
  for `birddoc.eu`.
- `.at` is **retained** as a permanent redirect (not retired) so existing inbound
  links, prior share cards and the Austrian brand keep resolving.

This supersedes the `.at`-canonical choice implied by ADR 0007 / ADR 0009; those
records keep their core decisions (IPAX/Caddy hosting; server-rendered landing).

## Considered options

- **Keep `.at` canonical, `.eu` redirects (status quo).** Rejected: entrenches an
  Austria-only canonical across SEO/sitemaps/sender identity right as the product
  starts courting an EU-wide audience — the costly thing to migrate later.
- **Drop `.at` entirely, serve only `.eu`.** Rejected: breaks existing inbound
  links and the established Austrian brand; the 301 is nearly free to keep.
- **Per-country domains (`birddoc.de`, `birddoc.ch`, …) now.** Rejected as
  premature — no second-country demand yet. `.eu` is the neutral umbrella; this
  can be revisited when a specific country's need is concrete.

## Consequences

- **Operational follow-ups (outside the repo):** point `birddoc.eu` +
  `app.birddoc.eu` DNS A records at the VPS (keep the `.at` records pointed there
  for the redirect + its certs); update the GitHub Actions secrets
  (`DJANGO_ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS`,
  `SESSION_COOKIE_DOMAIN`, `APP_LOGIN_URL`) to the `.eu` values; verify the
  `birddoc.eu` sender domain in Brevo and create the real `.eu` mailboxes.
- Caddy obtains a Let's Encrypt cert for all four hostnames; the `.at` hosts need
  certs too because they serve the 301 over HTTPS.
- No application code changes — canonical URLs, sitemap, `robots.txt` and OG tags
  follow the live request host automatically.
- `ARCHITECTURE.md`, `README.md`, `docs/deploy.md` and `backend/CLAUDE.md` are
  updated to show `.eu` as canonical and `.at` as the redirect.
