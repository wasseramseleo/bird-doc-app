# Parallel issue workflow (git worktrees + Claude Code)

How to work several issues at once without agents stepping on each other's files.
Used for the issues sliced from #21 (#22–#29).

## Why worktrees

A git worktree is a second working directory backed by the same repository. Each
worktree has its own branch and its own files on disk, so two Claude Code
instances editing the same file (e.g. `data-entry-form.ts`) never collide while
working. Conflicts only ever appear at **merge** time, not while editing.

## Setup

From anywhere inside the repo:

```bash
./setup-worktrees.sh            # all of #22–#29
./setup-worktrees.sh 23 25 27   # just a subset / one wave
```

This creates, per issue `<n>`:

- worktree directory `../bda-<n>` (sibling of the repo)
- branch `issue-<n>`, based on **`feedback-impl`** (where the #19 test seams,
  ADR-0002, and the CONTEXT.md glossary live — not `main`)
- a symlink to the shared `frontend/node_modules` (no issue changes deps)

Override the base with `--base <branch>` if needed.

## Run one Claude per worktree

```bash
cd ../bda-23
claude
/tdd implement GitHub issue #23; follow its acceptance criteria, run the tests, open a PR against feedback-impl. Use the playwright plugin for visual validation if you change the frontend. 
/tdd implement GitHub issue #37; follow its acceptance criteria, run the tests. Use the playwright plugin for visual validation if you change the frontend. 
```

In WebStorm: open each `../bda-<n>` as its own project window and run `claude` in
that window's integrated terminal. One window = one issue = one agent.

- **Frontend tests** (per `frontend/CLAUDE.md`):
  `CHROME_BIN=/usr/bin/google-chrome ./node_modules/.bin/ng test --watch=false --browsers=ChromeHeadless`
- **Backend issues** (#22, #27, #29): activate your existing virtualenv, `cd`
  into the worktree's `backend/`, run `pytest`. With Postgres, give parallel runs
  a distinct test DB to avoid collisions.

## How much to run at once

8 instances + 8 headless-Chrome runs + IDE indexing will overwhelm a laptop. Run
**waves of 3–4**.

All 8 issues are independent (no blockers), but two pairs overlap in the same form
component and will produce small **merge** conflicts:

- **#23 ↔ #24** — both touch the save/submit path
- **#23 ↔ #26** — both touch the keyboard `focusOrder`

So land **#23 (keyboard core) first**, then start #24 and #26 from the updated
`feedback-impl`. Everything else is disjoint.

Suggested waves:

- **Wave 1:** #23, #25, #27, #29
- **Wave 2:** #22, #28, and #24 + #26 (rebased on merged #23)

## Merge

Before merging a branch, rebase it on the latest `feedback-impl` so conflicts are
resolved in the feature branch, not on the shared branch. Then open/merge its PR
against `feedback-impl`.

## Cleanup

```bash
./setup-worktrees.sh --remove 23      # after #23 is merged
./setup-worktrees.sh --list           # check what's left
```
