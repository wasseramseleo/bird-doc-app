---
name: implement-prd
description: >-
  Orchestrate the full implementation phase of a PRD: take a parent/PRD issue
  whose sub-issues were already broken out (e.g. by /to-issues), and drive every
  ready-for-agent child to completion — each implemented test-first in its own
  isolated git worktree, respecting the blocker DAG, auto-merged into a fresh
  integration branch as it goes, ending in one PR to main for human review. Use
  this whenever the user wants to implement, build out, or "AFK" the sub-issues
  of a PRD or parent issue, orchestrate parallel worktree implementation of many
  issues, run the implementation phase after breaking a plan into issues, or asks
  to "implement PRD #N" / "build out the children of #N" / "ship all sub-issues of
  #N" — even if they don't name this skill. This is the orchestration layer that
  automates running /tdd across many worktrees. Requires the Workflow tool
  (ultracode) plus git + the gh CLI.
---

# Implement PRD

Orchestrate the implementation of every ready-for-agent child of a PRD, from
"issues exist on the tracker" to "one integration PR is open against main".

You are the **orchestrator**. You don't write feature code yourself — you plan the
work graph, fan out one isolated implementation agent per issue through the
**Workflow tool** (ultracode), gate and integrate their results, and loop wave by
wave until the graph is drained. The design leans entirely on ultracode
primitives: a per-issue `pipeline()`, `isolation: 'worktree'` for parallel safety,
schema-validated agent returns, and an outer loop-until-drained.

## Where this fits

Last step of a pipeline: idea → `/grill-with-docs` (a PRD issue) → `/to-issues`
(small, independently-implementable children, each with a `## Parent` back-ref and
a `## Blocked by` section) → **`/implement-prd`**. The children already exist; your
input is the parent/PRD issue reference.

## Prerequisites — stop early if missing

- **The Workflow tool (ultracode).** The whole design is a wave-by-wave fan-out
  through it. If unavailable, say so and offer the fallback — run the waves
  sequentially with one `Agent` subagent per issue — rather than silently
  degrading. The user chose orchestration for a reason.
- `git` and the `gh` CLI, authenticated against the repo's tracker.
- A parent issue whose children carry `## Parent #<n>` and `## Blocked by`
  sections. If the children don't exist, tell the user to run `/to-issues` first —
  this skill implements a breakdown, it doesn't create one.

## Step 0 — Profile the project

The skill is stack-agnostic, so first learn how *this* repo builds, tests, and
isolates parallel work. Read `references/project-profile.md` and produce a short
**profile** you inject into every agent prompt and the Workflow `args`:

- **Integration base** — the branch the final PR targets (the repo's default
  branch, almost always `main`).
- **Gates** — the ordered checks each worktree must pass before its PR opens
  (lint/format, type-check, tests, build — whatever this repo actually has).
  Discover the real commands; mark any that are **conditional** (run only when a
  change touches a given area) so agents skip irrelevant suites.
- **Parallel-isolation** — how to keep concurrent worktrees from colliding on any
  **shared mutable resource** (a test database, a cache, a fixed port): run against
  a per-checkout store, or key a unique instance to the issue number.
- **Tracker vocabulary** — the `gh` invocations and the label strings for "ready
  for an agent" vs "needs a human".

If a gate command is genuinely undiscoverable, ask once rather than guess — a wrong
test command passes nothing silently.

## Step 1 — Resolve the work graph

1. Fetch the parent and its children (open issues whose body references the parent
   via `## Parent #<n>`).
2. **Keep only `ready-for-agent` children.** Set the rest aside and list them as
   *deliberately skipped*, so nothing looks forgotten.
3. Parse each kept child's `## Blocked by` into dependency edges. A blocker is
   *satisfied* once its PR is merged into the integration branch.
4. Validate: every blocker must be a kept child or an already-merged issue. Flag
   cycles or dangling blockers and stop — a broken DAG needs fixing, not
   brute-forcing.
5. Compute **waves** as topological layers: wave 1 is everything with no
   unsatisfied blocker. Recompute as you go (parking a failure changes what its
   dependents can do) — waves aren't fixed upfront.

Present the plan — ordered waves, skipped issues with reasons, the integration
branch you'll create — before anything destructive. If the user is running you
fully AFK and said so, proceed; else get a nod.

## Step 2 — Create the integration branch

Create `prd-<parent#>` from an up-to-date base (fetch, then branch off
`origin/<base>`) and push it so sub-PRs have a base to target. Every sub-PR targets
this branch; only the final PR merges to main.

## Step 3 — The wave loop (the heart)

Loop until no ready issue remains — the ultracode **loop-until-drained** pattern.
Each iteration handles one wave.

The correctness point that makes wave-merging work: a worktree is cut from the
repo's *current* HEAD, so before launching a wave, have `prd-<parent#>` checked out
locally and updated with every prior merge. This wave's worktrees then inherit
their blockers' code for free.

### 3a — Launch the wave (Workflow)

Author a Workflow (skeleton in `references/workflow-template.js`) that runs **one
`pipeline()` per issue**, so each issue flows implement → review → fix
independently, with no barrier between issues:

- **Implement** (`isolation: 'worktree'`): the agent implements *exactly one* issue
  test-first via `/tdd`, honours its acceptance criteria, gets every applicable
  gate green **in its own worktree** (it's ephemeral — unpushed green is worthless),
  then commits, pushes `issue-<n>`, and opens a PR against `prd-<parent#>` with
  `Closes #<n>`. It returns a schema-validated result, not prose.
- **Review**: an independent agent reviews the PR diff (`/code-review`). Independent
  review beats self-review — the implementer is the worst judge of its own blind
  spots.
- **Fix** (bounded): on must-fix findings, an agent fixes them in the same branch
  and re-gates. Cap implement+fix at **2 attempts** total; past that, the issue is a
  failure for 3c.

Pass the profile, integration branch, and this wave's issue list via `args` so the
template stays generic.

### 3b — Integrate the green PRs

Merge in the orchestrator, never inside the Workflow — parallel worktree agents
can't safely mutate the shared integration branch. For each clean-and-reviewed
issue, squash-merge its PR into `prd-<parent#>` and update your local branch. Merge
**sequentially, pulling between merges**: two same-wave issues can touch the same
files, so a later merge may conflict though both were individually green. A conflict
you can't cleanly auto-resolve is a failure (3c) — often a quick rebase-and-retry
fixes it, which the bounded retry affords.

### 3c — Failure policy

For any issue that couldn't go green within its attempts (stuck agent, red gates,
unresolved review, merge conflict):

- Comment the concrete failure on the issue (what failed, last error, PR link),
  leave its PR open as a **draft**, and label it `needs-human`.
- **Skip its dependents** — they can't build on unmerged code. Mark them
  `blocked-skipped` for the report and don't attempt them.
- **Keep going** with every independent issue. One bad issue must not sink an
  otherwise-good PRD; bounded retry lets flaky failures self-heal and parks genuine
  ones without blocking the rest.

### 3d — Recompute and continue

Recompute the ready set against the updated branch and parked set, log a one-line
wave summary (merged / parked / newly-unblocked) so the user can follow long runs,
and loop.

## Step 4 — Open the integration PR

When the graph is drained, open **one** PR: `prd-<parent#>` → main. Do **not** merge
it — that's the human's gate. The body should let a reviewer grasp the whole PRD at
a glance: a link + one-paragraph summary of what shipped, a children → merged-sub-PR
table with acceptance-criteria coverage, any parked/skipped issues called out
honestly with reasons, and `Closes #<parent>` (each sub-PR's `Closes #<child>` then
closes the children when this merges).

## Step 5 — Report

Summarise straight: integration branch + PR link, issues merged, issues parked
`needs-human` (with why), issues skipped because a blocker was parked. "7 of 9
merged, #123 parked on a failing round-trip test, #126 skipped because it needs
#123" is far more useful than a cheerful "done".

## Structured result (implement/review agents → orchestrator)

Have each pipeline return this so integration is deterministic, not prose-parsing:

```json
{
  "issue": 120,
  "status": "green | failed",
  "prNumber": 128,
  "prUrl": "https://…",
  "branch": "issue-120",
  "gates": { "lint": "pass", "test": "pass", "build": "skipped" },
  "review": { "clean": true, "unresolved": [] },
  "attempts": 1,
  "failureReason": null
}
```

## Guardrails

- **Never touch the parent PRD's body or state**, and never edit a child's
  acceptance criteria to make it pass. Underspecified → park for a human; silently
  reinterpreting scope defeats the point of the breakdown.
- **The final PR is the only human gate you must preserve.** Auto-merging sub-PRs
  into the integration branch is expected; auto-merging to main is not.
- **Isolation is load-bearing.** One issue per worktree, one worktree per agent. Two
  issues in one branch breaks the 1:1 issue↔PR mapping and the failure/park model.
- Scale parallelism to the Workflow concurrency cap (or `budget`, if the user set a
  token target) — you need it for speed, not correctness.

## Reference files

- `references/project-profile.md` — discover the integration base, gate commands,
  and parallel-isolation for *this* repo, stack-agnostically.
- `references/workflow-template.js` — the per-wave Workflow skeleton (per-issue
  pipeline: implement → review → fix), parameterised via `args`.
