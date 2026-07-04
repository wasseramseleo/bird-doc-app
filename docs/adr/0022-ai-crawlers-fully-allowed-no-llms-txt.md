---
status: accepted
---

# AI crawlers stay fully allowed; no llms.txt

## Context

BirdDoc wants to appear in AI answer surfaces (Google AI Overviews/AI Mode,
ChatGPT, Perplexity, Claude, Gemini) — for commercial queries
("Beringungssoftware") and as the citable reference behind the public Wissen
pages. `robots.txt` currently allows everything by default.

Two AI-crawler classes exist and the fashionable defaults differ per class:

- **Answer/search crawlers** (`OAI-SearchBot`, `PerplexityBot`,
  `Claude-SearchBot`, plus live user-fetchers `ChatGPT-User` /
  `Perplexity-User` / `Claude-User`). Blocking these directly removes the site
  from AI answers — OpenAI states opted-out sites "will not be shown in
  ChatGPT search answers".
- **Training crawlers** (`GPTBot`, `ClaudeBot`, `CCBot`, `Google-Extended`,
  …). Blocking these is the fashionable content-protection default across the
  web, and costs nothing for *live-search* AI visibility.

`llms.txt` is widely promoted as an "AI SEO" measure. The evidence says
otherwise: Google states it does not use such files (Mueller: "comparable to
the keywords meta tag"), no major AI vendor has committed to consuming it, and
an Ahrefs log study across 137K domains found 97% of published `llms.txt`
files received zero requests.

## Decision

All AI crawlers — **including training crawlers** — stay allowed. `robots.txt`
keeps its plain `Allow: /` posture with no AI-specific rules, and no
`llms.txt` is published.

Training-corpus presence is the only path into a model's *parametric*
knowledge — the knowledge that answers recommendation prompts when the model
does not search the live web. For a niche product whose entire goal is that
LLMs know it exists, blocking training bots would trade away exactly the
visibility this site is optimising for, to protect public marketing/reference
content that is meant to be read and cited. (Blocking is also leaky in
practice: a 4M-citation study found 82–92% of bot-blocking sites still got
cited, just less accurately.)

## Consequences

- Public content (marketing pages, Wissen reference) will be ingested into
  AI training corpora and cannot be recalled later — acceptable and intended
  for this surface; tenant data is unaffected (the API is auth-gated and
  `Disallow: /api/`).
- A future engineer should not "fix" `robots.txt` by adding the popular
  GPTBot/ClaudeBot blocks — that would be a regression of this decision.
- Signup-gated content (numeric Artennorm values) stays protected by the
  auth gate, not by robots rules — publishing any slice of it remains a
  separate, deliberate decision (tracked follow-up; provenance sign-off
  required).
- Revisit only if the trade-off itself changes (e.g. content-licensing value
  emerges, or vendors adopt a consumed successor to `llms.txt`).
