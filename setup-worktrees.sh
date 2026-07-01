#!/usr/bin/env bash
#
# setup-worktrees.sh — create isolated git worktrees for parallel issue work.
#
# Each issue <n> becomes its own worktree (../bda-worktrees/bda-<n>) on its own
# branch (issue-<n>), based on a shared base branch (default: feedback-impl).
# All worktrees live together under one dedicated root (../bda-worktrees) rather
# than scattered as repo siblings, so a single entry in
# permissions.additionalDirectories grants agents file access to every worktree.
# The frontend node_modules and backend .venv are symlinked from the main
# checkout so you don't reinstall per worktree (none of these issues change
# package.json / pyproject). Run one Claude Code instance per worktree — git
# worktrees give each agent its own working copy, so they never touch the same
# file on disk.
#
set -euo pipefail

DEFAULT_ISSUES=(22 23 24 25 26 27 28 29)
BASE_BRANCH="feedback-impl"
PREFIX="bda"            # worktree dir prefix -> ../bda-worktrees/bda-22
ACTION="create"

usage() {
  cat <<'EOF'
setup-worktrees.sh — isolated git worktrees for parallel issue work.

Usage:
  ./setup-worktrees.sh                 create worktrees for all default issues
  ./setup-worktrees.sh 22 23 25        create only the listed issues
  ./setup-worktrees.sh --base main 22  use a different base branch
  ./setup-worktrees.sh --remove 22 23  remove the listed worktrees + branches
  ./setup-worktrees.sh --list          list current worktrees

Each issue <n> becomes:
  worktree dir : ../bda-worktrees/bda-<n>   (under one dedicated root)
  branch       : issue-<n>    (based on the base branch, default feedback-impl)
The frontend node_modules and backend .venv are symlinked from the main checkout.
EOF
}

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "error: not inside a git repository" >&2; exit 1
}
PARENT_DIR="$(dirname "$REPO_ROOT")"
WORKTREE_ROOT="$PARENT_DIR/bda-worktrees"   # one grantable root for all worktrees

issues=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)   BASE_BRANCH="$2"; shift 2 ;;
    --remove) ACTION="remove"; shift ;;
    --list)   ACTION="list"; shift ;;
    -h|--help) usage; exit 0 ;;
    --*) echo "unknown option: $1" >&2; usage; exit 1 ;;
    *) issues+=("$1"); shift ;;
  esac
done
[[ ${#issues[@]} -eq 0 ]] && issues=("${DEFAULT_ISSUES[@]}")

if [[ "$ACTION" == "list" ]]; then
  git -C "$REPO_ROOT" worktree list
  exit 0
fi

[[ "$ACTION" == "create" ]] && mkdir -p "$WORKTREE_ROOT"

for n in "${issues[@]}"; do
  branch="issue-$n"
  wt="$WORKTREE_ROOT/$PREFIX-$n"

  if [[ "$ACTION" == "remove" ]]; then
    if git -C "$REPO_ROOT" worktree list --porcelain | grep -qF "worktree $wt"; then
      if git -C "$REPO_ROOT" worktree remove "$wt"; then
        echo "removed worktree $wt"
      else
        echo "  could not remove $wt (uncommitted changes?) — 'git worktree remove --force $wt'" >&2
      fi
    fi
    if git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/$branch"; then
      git -C "$REPO_ROOT" branch -D "$branch" >/dev/null && echo "deleted branch $branch"
    fi
    continue
  fi

  # --- create ---
  if [[ -e "$wt" ]]; then
    echo "skip #$n: $wt already exists"
    continue
  fi

  if git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/$branch"; then
    git -C "$REPO_ROOT" worktree add "$wt" "$branch"
  else
    git -C "$REPO_ROOT" worktree add -b "$branch" "$wt" "$BASE_BRANCH"
  fi

  # share frontend deps (no issue changes package.json)
  if [[ -d "$REPO_ROOT/frontend/node_modules" && ! -e "$wt/frontend/node_modules" ]]; then
    ln -s "$REPO_ROOT/frontend/node_modules" "$wt/frontend/node_modules"
    echo "  linked frontend/node_modules"
  fi

  # share backend virtualenv (no issue changes pyproject; tests only read it)
  if [[ -d "$REPO_ROOT/backend/.venv" && ! -e "$wt/backend/.venv" ]]; then
    ln -s "$REPO_ROOT/backend/.venv" "$wt/backend/.venv"
    echo "  linked backend/.venv"
  fi

  echo "ready #$n -> $wt (branch $branch)"
done

if [[ "$ACTION" == "create" ]]; then
  cat <<EOF

Next:
  cd $WORKTREE_ROOT/$PREFIX-<n>
  claude
  > implement GitHub issue #<n>; follow its acceptance criteria, run the tests, open a PR against $BASE_BRANCH

Backend issues (#22 #27 #29): the worktree's backend/.venv is symlinked to the
main checkout, so run tests read-only against it — e.g. 'cd backend &&
.venv/bin/python -m pytest' (avoid concurrent 'uv sync' on the shared venv).
Give parallel backend runs a distinct test DB — unset DATABASE_URL for the
worktree-local SQLite default, or name a per-issue Postgres DB — to avoid
collisions.

Cleanup once a branch is merged:
  ./setup-worktrees.sh --remove <n> [<n> ...]
EOF
fi
