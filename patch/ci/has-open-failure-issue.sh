#!/usr/bin/env bash
set -euo pipefail

# Usage: has-open-failure-issue.sh --tag <tag> [--repo <owner/name>]
# Prints open=true when an open blocking fork-sync issue exactly matches the tag.

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/failure-issue-title.sh"

REPO=${REPO:-}
TAG=${TARGET_TAG:-}

usage() {
  printf '%s\n' "Usage: $0 --tag <tag> [--repo <owner/name>]" >&2
  exit 64
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --tag)
      [ "$#" -ge 2 ] || usage
      TAG=$2
      shift 2
      ;;
    --repo)
      [ "$#" -ge 2 ] || usage
      REPO=$2
      shift 2
      ;;
    -h|--help)
      usage
      ;;
    *)
      usage
      ;;
  esac
done

if [ -z "$REPO" ]; then
  printf '%s\n' 'REPO is not set; pass --repo or set REPO' >&2
  exit 1
fi

if ! [[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  printf 'tag is not a stable release tag: %s\n' "$TAG" >&2
  exit 2
fi

issue_titles=$(gh issue list \
  --repo "$REPO" \
  --state open \
  --label fork-sync \
  --limit 100 \
  --json number,title \
  --jq '.[].title')

open=false
title_template=$(failure_issue_title '__tag__' '__stage__')
title_prefix=${title_template%__tag__ (__stage__)}
issue_suffix_pattern='^(v[0-9]+\.[0-9]+\.[0-9]+) \(([^)]*)\)$'
while IFS= read -r issue_title; do
  [ -n "$issue_title" ] || continue
  case "$issue_title" in
    "$title_prefix"*) issue_suffix=${issue_title#"$title_prefix"} ;;
    *) continue ;;
  esac
  if [[ "$issue_suffix" =~ $issue_suffix_pattern ]]; then
    issue_tag=${BASH_REMATCH[1]}
    issue_stage=${BASH_REMATCH[2]}
    expected_title=$(failure_issue_title "$issue_tag" "$issue_stage")
    if [ "$issue_tag" = "$TAG" ] && [ "$issue_stage" != sync-main ] && \
      [ "$issue_title" = "$expected_title" ]; then
      open=true
      break
    fi
  fi
done <<< "$issue_titles"

printf 'open=%s\n' "$open"
