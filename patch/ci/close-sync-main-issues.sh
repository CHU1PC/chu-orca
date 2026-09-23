#!/usr/bin/env bash
set -euo pipefail

# Usage: close-sync-main-issues.sh
# Closes every open sync-main issue after the fork main branch is synchronized.

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/failure-issue-title.sh"

REPO=${REPO:-}
RUN_URL=${RUN_URL:-local}

if [ -z "$REPO" ]; then
  printf '%s\n' 'REPO is not set; pass --repo or set REPO' >&2
  exit 1
fi

issue_rows=$(gh issue list \
  --repo "$REPO" \
  --state open \
  --label fork-sync \
  --limit 100 \
  --json number,title \
  --jq '.[] | [.number, .title] | @tsv')

while IFS="$(printf '\t')" read -r issue_number issue_title; do
  [ -n "$issue_number" ] || continue
  title_template=$(failure_issue_title '__tag__' sync-main)
  title_prefix=${title_template%__tag__ (sync-main)}
  case "$issue_title" in
    "$title_prefix"*' (sync-main)')
      issue_tag=${issue_title#"$title_prefix"}
      issue_tag=${issue_tag% (sync-main)}
      ;;
    *) continue ;;
  esac
  if [ -n "$issue_tag" ]; then
    expected_title=$(failure_issue_title "$issue_tag" sync-main)
    [ "$issue_title" = "$expected_title" ] || continue
    comment_body=$(printf 'sync-main recovered; closing this issue. Run: %s' "$RUN_URL")

    if [ "${DRY_RUN:-0}" = 1 ]; then
      printf 'DRY_RUN: gh issue comment %s --repo %s --title %s --body %s\n' \
        "$issue_number" "$REPO" "$issue_title" "$comment_body"
      printf 'DRY_RUN: gh issue close %s --repo %s --title %s\n' \
        "$issue_number" "$REPO" "$issue_title"
    else
      gh issue comment "$issue_number" --repo "$REPO" --body "$comment_body"
      gh issue close "$issue_number" --repo "$REPO"
    fi
  fi
done <<< "$issue_rows"
