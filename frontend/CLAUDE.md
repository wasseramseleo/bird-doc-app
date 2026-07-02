# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
ng serve          # Dev server at http://localhost:4200
ng build          # Production build → dist/
ng test           # Unit tests via Karma/Jasmine (watch mode — never exits)
ng generate component <name>  # Scaffold a new standalone component
```

The Django REST Framework backend must be running separately at `http://localhost:8000` (see `../backend/CLAUDE.md`).

### Running unit tests headless (do this, in this exact way)

From `frontend/`:

```bash
CHROME_BIN=/usr/bin/google-chrome ./node_modules/.bin/ng test --watch=false --browsers=ChromeHeadless
```

The builder is `@angular/build:karma` (no `karma.conf.js`, no `src/test.ts`). The suite finishes in **~3 seconds**, exits **0**, and leaves **no** lingering `ng`/`karma`/`ChromeHeadless` processes.

**Invocation rules — follow these or the run will appear to "hang":**
- Call the **direct binary `./node_modules/.bin/ng`** — do **NOT** use `npx ng test`. The RTK hook rewrites `npx ...` to `rtk npx ...`, and ng test wrapped by the rtk proxy **hangs until timeout and emits zero output** (this is why "ng test produces no output even in the foreground"). The direct binary is passed through unchanged by rtk, so output streams normally. (As a backstop, `npx` is in `exclude_commands` in `~/.config/rtk/config.toml`, but the env-var prefix above defeats that match — always use the direct binary.)
- Run it in the **FOREGROUND**. Never run it as a background task — a background shell stays open after the inner command exits, so the task only ends when its timeout fires (looks like a 5-minute hang; the tests actually finished in 3s).
- Use a **short timeout** (the default ~120s is plenty). Never set a 300s/5-min timeout — there is nothing to wait for.
- `--watch=false` is **mandatory** (plain `ng test` defaults to watch mode and never exits).
- Do **not** `pkill` afterward — nothing lingers, and `pkill` returns 144 (SIGTERM), which falsely reads as a test failure.
- `chrome` processes with `--profile-directory=Default` are the user's desktop browser, not the test runner — never kill them.
- If the build fails with `Could not resolve "@angular/animations/browser"`, run `npm install` first (deps can be incompletely installed even though `@angular/animations` is in package.json).

### Running e2e tests (Playwright)

End-to-end tests live in `e2e/` and drive the real app in a browser via `@playwright/test` (`playwright.config.ts`).

From `frontend/`:

```bash
npm run e2e                                     # all e2e tests (~2s once the server is up) — preferred
PLAYWRIGHT_FORCE_ASYNC_LOADER=1 ./node_modules/.bin/playwright test e2e/navigation-hub.spec.ts   # one file
```

**Always set `PLAYWRIGHT_FORCE_ASYNC_LOADER=1`** (the `npm run e2e` script does this for you). Without it, any spec that imports a local helper module (e.g. `e2e/status-menu-helpers.ts`) fails at load with `TypeError: context.conditions?.includes is not a function` — a Playwright 1.61 + Node 22 bug in the *synchronous* module loader (`playwright/lib/transform/esmLoader.js`, `context.conditions?.includes('import')`). The env var forces Playwright's async loader, which resolves cross-file spec imports correctly. The bug is dormant only for specs with no cross-file imports, so the bare `playwright test` will look like it works right up until it doesn't.

How it's wired (and why it's fast and backend-free):
- **System Chrome, no browser download.** The config sets `channel: 'chrome'`, reusing `/usr/bin/google-chrome` (same browser Karma uses). Do **not** run `playwright install` — it's unnecessary and may fail offline.
- **The backend is stubbed, not run.** Every test intercepts `**/api/**` via `page.route(...)` and fulfils canned JSON, so **no Django backend at `:8000` is needed**. Always stub `GET /api/auth/me/` to an authenticated user — the `provideAppInitializer` → `AuthService.bootstrap()` call blocks routing, and `authGuard` redirects to `/login` without it.
- **`ng serve` starts automatically.** The `webServer` block launches `./node_modules/.bin/ng serve` and waits for `:4200` (`reuseExistingServer` is on locally, so an already-running dev server is reused). The dev build points the API at `:8000`, but the route stubs intercept those calls regardless.

**Invocation rules — same spirit as the unit tests:**
- Call the **direct binary `./node_modules/.bin/playwright`** (or `npm run e2e`) — never `npx playwright`, which the RTK hook would wrap and hang.
- Run in the **FOREGROUND** with the default timeout. The first run spends up to ~120s only if it has to cold-start `ng serve`; the tests themselves take ~1–2s.
- Output dirs (`test-results/`, `playwright-report/`) are git-ignored — don't commit them.

## Architecture

Single-page Angular 21 app for bird-ringing field data entry, behind a session-auth gate. `AppComponent` renders a `NavBarComponent` (only when authenticated) plus a `RouterOutlet`. Routes: `/` → `HomeComponent` (project hub), `/login` → `LoginComponent`, `/data-entry` → `DataEntryFormComponent` (create), `/data-entry/:id` → edit, `/data-entries` → `DataEntryListComponent`. `authGuard`/`guestGuard` gate them (`core/guards/`).

**Key files:**
- `src/app/data-entry-form/data-entry-form.ts` — the main form component; handles create/edit modes, autocomplete search, ring history lookup, and form submission
- `src/app/service/api.service.ts` — all HTTP calls to the Django backend (`http://localhost:8000/api/birds/`)
- `src/app/models/` — TypeScript interfaces and enums mirroring backend models
- `src/app/core/directives/select-on-tab.ts` — selects the active autocomplete option on Tab keypress
- `src/app/shared/directives/focus-next.ts` — advances focus to the next form field on Enter/selection

**Data flow:**
1. Autocomplete fields (species, ringing station, scientist) use RxJS `valueChanges` → `debounceTime(300)` → `switchMap` to the API
2. When a species is selected, its `ring_size` pre-fills the ring size selector
3. When ring size + `BirdStatus.FirstCatch` are set, the next ring number is fetched automatically via an Angular `effect()`
4. On submit, `transformFromForm()` converts nested objects to flat write-only IDs (`species_id`, `staff_id`, `ringing_station_id`) before POSTing/PUTting
5. After a successful save, `cleanReset()` resets all fields except `ringing_station` and `staff` (Beringer). The active Projekt is not a form field — it lives on the project signal and survives automatically; the organization derives from `currentProject().organization`

**Read vs. write shape:** The API returns nested objects on GET but expects flat IDs on POST/PUT/PATCH — the two shapes are intentionally different. Never POST to `/rings/` directly; send `ring_number` + `ring_size` and the backend handles ring creation.

## Angular conventions

Canonical Angular guidance lives in [`LLM.md`](LLM.md) — standalone components, signals/`computed()`, `input()`/`output()` functions, `OnPush`, native control flow, `inject()`, reactive forms, and `host`-object bindings (no `@HostBinding`/`@HostListener`). Follow it for any frontend work.

## Locale

The app is configured with `LOCALE_ID: 'de-AT'` (Austrian German). All date and float values must be formatted using Austria German conventions.

## Keyboard UX pattern

`SelectOnTabDirective` (`input[selectOnTab]`) confirms the highlighted autocomplete option on Tab and advances focus. `DataEntryFormComponent.onSelectKeydown()` maps single-character shortcuts (`key` property of `SelectOption`) to enum values for `MatSelect` fields and then calls `focusNext()` to advance focus through `focusOrder`.

<!-- rtk-instructions v2 -->
# RTK (Rust Token Killer) - Token-Optimized Commands

## Golden Rule

**Always prefix commands with `rtk`**. If RTK has a dedicated filter, it uses it. If not, it passes through unchanged. This means RTK is always safe to use.

**Important**: Even in command chains with `&&`, use `rtk`:
```bash
# ❌ Wrong
git add . && git commit -m "msg" && git push

# ✅ Correct
rtk git add . && rtk git commit -m "msg" && rtk git push
```

## RTK Commands by Workflow

### Build & Compile (80-90% savings)
```bash
rtk cargo build         # Cargo build output
rtk cargo check         # Cargo check output
rtk cargo clippy        # Clippy warnings grouped by file (80%)
rtk tsc                 # TypeScript errors grouped by file/code (83%)
rtk lint                # ESLint/Biome violations grouped (84%)
rtk prettier --check    # Files needing format only (70%)
rtk next build          # Next.js build with route metrics (87%)
```

### Test (60-99% savings)
```bash
rtk cargo test          # Cargo test failures only (90%)
rtk go test             # Go test failures only (90%)
rtk jest                # Jest failures only (99.5%)
rtk vitest              # Vitest failures only (99.5%)
rtk playwright test     # Playwright failures only (94%)
rtk pytest              # Python test failures only (90%)
rtk rake test           # Ruby test failures only (90%)
rtk rspec               # RSpec test failures only (60%)
rtk test <cmd>          # Generic test wrapper - failures only
```

### Git (59-80% savings)
```bash
rtk git status          # Compact status
rtk git log             # Compact log (works with all git flags)
rtk git diff            # Compact diff (80%)
rtk git show            # Compact show (80%)
rtk git add             # Ultra-compact confirmations (59%)
rtk git commit          # Ultra-compact confirmations (59%)
rtk git push            # Ultra-compact confirmations
rtk git pull            # Ultra-compact confirmations
rtk git branch          # Compact branch list
rtk git fetch           # Compact fetch
rtk git stash           # Compact stash
rtk git worktree        # Compact worktree
```

Note: Git passthrough works for ALL subcommands, even those not explicitly listed.

### GitHub (26-87% savings)
```bash
rtk gh pr view <num>    # Compact PR view (87%)
rtk gh pr checks        # Compact PR checks (79%)
rtk gh run list         # Compact workflow runs (82%)
rtk gh issue list       # Compact issue list (80%)
rtk gh api              # Compact API responses (26%)
```

### JavaScript/TypeScript Tooling (70-90% savings)
```bash
rtk pnpm list           # Compact dependency tree (70%)
rtk pnpm outdated       # Compact outdated packages (80%)
rtk pnpm install        # Compact install output (90%)
rtk npm run <script>    # Compact npm script output
rtk npx <cmd>           # Compact npx command output
rtk prisma              # Prisma without ASCII art (88%)
```

### Files & Search (60-75% savings)
```bash
rtk ls <path>           # Tree format, compact (65%)
rtk read <file>         # Code reading with filtering (60%)
rtk grep <pattern>      # Search grouped by file (75%). Format flags (-c, -l, -L, -o, -Z) run raw.
rtk find <pattern>      # Find grouped by directory (70%)
```

### Analysis & Debug (70-90% savings)
```bash
rtk err <cmd>           # Filter errors only from any command
rtk log <file>          # Deduplicated logs with counts
rtk json <file>         # JSON structure without values
rtk deps                # Dependency overview
rtk env                 # Environment variables compact
rtk summary <cmd>       # Smart summary of command output
rtk diff                # Ultra-compact diffs
```

### Infrastructure (85% savings)
```bash
rtk docker ps           # Compact container list
rtk docker images       # Compact image list
rtk docker logs <c>     # Deduplicated logs
rtk kubectl get         # Compact resource list
rtk kubectl logs        # Deduplicated pod logs
```

### Network (65-70% savings)
```bash
rtk curl <url>          # Compact HTTP responses (70%)
rtk wget <url>          # Compact download output (65%)
```

### Meta Commands
```bash
rtk gain                # View token savings statistics
rtk gain --history      # View command history with savings
rtk discover            # Analyze Claude Code sessions for missed RTK usage
rtk proxy <cmd>         # Run command without filtering (for debugging)
rtk init                # Add RTK instructions to CLAUDE.md
rtk init --global       # Add RTK to ~/.claude/CLAUDE.md
```

## Token Savings Overview

| Category | Commands | Typical Savings |
|----------|----------|-----------------|
| Tests | vitest, playwright, cargo test | 90-99% |
| Build | next, tsc, lint, prettier | 70-87% |
| Git | status, log, diff, add, commit | 59-80% |
| GitHub | gh pr, gh run, gh issue | 26-87% |
| Package Managers | pnpm, npm, npx | 70-90% |
| Files | ls, read, grep, find | 60-75% |
| Infrastructure | docker, kubectl | 85% |
| Network | curl, wget | 65-70% |

Overall average: **60-90% token reduction** on common development operations.
<!-- /rtk-instructions -->