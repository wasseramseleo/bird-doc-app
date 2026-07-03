# Project profile

Before orchestrating, learn how *this* repo builds, tests, and isolates parallel
work. Produce a small profile object you inject into every agent prompt and the
Workflow `args`. Discover values from the repo — never hard-code one stack's
conventions into a stack-agnostic skill.

## Integration base branch

The branch the final PR targets — the repo's default branch
(`gh repo view --json defaultBranchRef`, or
`git symbolic-ref refs/remotes/origin/HEAD`), almost always `main`. Your
integration branch is `prd-<parent#>` off this base.

## Worktree isolation

The Workflow tool's built-in `isolation: 'worktree'` gives each implement agent a
clean worktree cut from your checked-out integration-branch HEAD, so it inherits
already-merged blocker code. Set the repo's `worktree.baseRef: "head"` (cut from
HEAD, not `origin/main`) and `worktree.symlinkDirectories` (so dependencies aren't
reinstalled per worktree) for this to run smoothly.

If a repo ships its own worktree script you may use it instead — but then its
directory must be in `permissions.additionalDirectories` (or live inside the repo,
e.g. a gitignored `.worktrees/`), or every edit in it prompts and stalls an AFK run.
Harness-managed isolation worktrees are auto-granted; script-created ones aren't.

The invariant either way: **each agent gets a clean worktree cut from the current
`prd-<parent#>` HEAD.**

## Gate commands

The checks each worktree must pass before its PR opens. Find the *real* commands —
check `CLAUDE.md`/`AGENTS.md`, the build/package manifest, `Makefile`, the CI
config, and `docs/agents/*`. A repo typically has some subset of:

- **Lint / format check**
- **Type-check**
- **Tests** (unit / integration)
- **Build**

Record them as an ordered list. Mark any gate that's **conditional** — one that only
matters when a change touches a given area (e.g. a UI suite for UI-only changes) —
with its condition, so agents don't run irrelevant suites. If a gate command is
undiscoverable, ask the user once rather than guess — a wrong command passes nothing
silently.

## Parallel-isolation for shared resources

Worktrees run their suites concurrently, so any **shared mutable resource** the tests
touch will collide: a test database, a cache, a message broker, a fixed port, a
shared fixtures directory. Two options, in preference order:

1. **Per-checkout store** — if the tests default to state scoped to the working
   directory (a file under the checkout, an in-memory instance), each worktree is
   already isolated by its own path. Prefer this; confirm the suite actually passes
   that way.
2. **Per-issue instance** — otherwise give each worktree a unique instance keyed by
   the issue number (a distinct DB name, port, or namespace) so nothing collides.
   Never let two worktrees create the same shared resource concurrently.

Bake the exact isolating command into the implement agent's prompt so it isn't
rediscovered per run.

## Tracker + triage vocabulary

From `docs/agents/*` or equivalent: the `gh` commands to view/label/comment, and the
label strings for "ready for an agent" and "needs a human". You filter children to
the former and park failures under the latter.

## Profile object to carry forward

```json
{
  "integrationBase": "main",
  "integrationBranch": "prd-113",
  "gates": [
    { "name": "lint",  "cmd": "<lint/format check>" },
    { "name": "test",  "cmd": "<test command>", "isolate": "<per-issue DB/port/namespace, or per-checkout store>" },
    { "name": "build", "cmd": "<build>", "when": "onlyIf(<changed area>)" }
  ],
  "labels": { "ready": "ready-for-agent", "needsHuman": "needs-human" }
}
```

Fill every value from the repo you're in — the placeholders name the shape, not the
stack.
