#!/usr/bin/env bash
set -euo pipefail

# Usage: rebase-onto-tag.sh <old-tag> <new-tag> <branch> [conflicts-file]
# Rebases a clean checked-out branch and restores its original SHA on conflict.

if [ "$#" -lt 3 ] || [ "$#" -gt 4 ]; then
  printf '%s\n' "Usage: $0 <old-tag> <new-tag> <branch> [conflicts-file]" >&2
  exit 64
fi

old_tag=$1
new_tag=$2
branch=$3
conflicts_file=${4-}

is_rebase_ref() {
  [[ "$1" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

if ! is_rebase_ref "$old_tag" || ! is_rebase_ref "$new_tag"; then
  printf 'old and new must be stable release tags: %s %s\n' "$old_tag" "$new_tag" >&2
  exit 2
fi

current_branch=$(git branch --show-current)
if [ "$current_branch" != "$branch" ]; then
  printf 'current branch is %s, expected %s\n' "$current_branch" "$branch" >&2
  exit 3
fi

status=$(git status --porcelain)
if [ -n "$status" ]; then
  printf '%s\n' 'rebase-onto-tag.sh requires a clean Git worktree:' >&2
  printf '%s\n' "$status" >&2
  exit 4
fi

original_sha=$(git rev-parse --verify "${branch}^{commit}")
git rev-parse --verify "${old_tag}^{commit}" >/dev/null
git rev-parse --verify "${new_tag}^{commit}" >/dev/null

set +e
git rebase --onto "$new_tag" "$old_tag" "$branch"
rebase_status=$?
set -e

if [ "$rebase_status" -eq 0 ]; then
  exit 0
fi

conflicted_paths=$(git diff --name-only --diff-filter=U)
if [ -n "$conflicts_file" ]; then
  : > "$conflicts_file"
  if [ -n "$conflicted_paths" ]; then
    printf '%s\n' "$conflicted_paths" > "$conflicts_file"
  fi
fi
if [ -n "$conflicted_paths" ]; then
  printf '%s\n' "$conflicted_paths"
fi

git rebase --abort >/dev/null 2>&1 || true
restored_sha=$(git rev-parse --verify "${branch}^{commit}")
if [ "$restored_sha" != "$original_sha" ]; then
  git reset --hard "$original_sha"
fi

if [ -n "$conflicted_paths" ]; then
  exit 5
fi
exit 6
