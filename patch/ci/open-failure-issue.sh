#!/usr/bin/env bash
set -euo pipefail

# Usage: open-failure-issue.sh --tag <tag> --stage <stage> --old <tag> --new <tag>
# Finds or creates one fork-sync issue; DRY_RUN=1 prints commands without writes.

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/failure-issue-title.sh"

REPO=${REPO:-}
RUN_URL=${RUN_URL:-${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-$REPO}/actions/runs/${GITHUB_RUN_ID:-local}}
TAG=${TARGET_TAG:-}
STAGE=${FAILURE_STAGE:-}
OLD_TAG=${OLD_TAG:-unknown}
NEW_TAG=${NEW_TAG:-unknown}
DETAILS=${DETAILS:-}
DETAILS_FILE=${DETAILS_FILE:-}

usage() {
  printf '%s\n' "Usage: $0 --tag <tag> --stage <stage> --old <tag> --new <tag> [--details <text>] [--details-file <path>]" >&2
  exit 64
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --tag)
      [ "$#" -ge 2 ] || usage
      TAG=$2
      shift 2
      ;;
    --stage)
      [ "$#" -ge 2 ] || usage
      STAGE=$2
      shift 2
      ;;
    --old)
      [ "$#" -ge 2 ] || usage
      OLD_TAG=$2
      shift 2
      ;;
    --new)
      [ "$#" -ge 2 ] || usage
      NEW_TAG=$2
      shift 2
      ;;
    --details)
      [ "$#" -ge 2 ] || usage
      DETAILS=$2
      shift 2
      ;;
    --details-file)
      [ "$#" -ge 2 ] || usage
      DETAILS_FILE=$2
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

[ -n "$TAG" ] || usage
[ -n "$STAGE" ] || usage

if [ -n "$DETAILS_FILE" ] && [ -f "$DETAILS_FILE" ]; then
  file_details=$(cat "$DETAILS_FILE")
  if [ -n "$DETAILS" ] && [ -n "$file_details" ]; then
    DETAILS=$(printf '%s\n%s' "$DETAILS" "$file_details")
  elif [ -n "$file_details" ]; then
    DETAILS=$file_details
  fi
fi

title=$(failure_issue_title "$TAG" "$STAGE")
body=$(printf 'Stage: %s\nOld tag: %s\nNew tag: %s\nRun: %s\n\nDetails:\n%s\n' \
  "$STAGE" "$OLD_TAG" "$NEW_TAG" "$RUN_URL" "$DETAILS")

if [ "${DRY_RUN:-0}" = 1 ]; then
  label_exists=$(gh label list --repo "$REPO" --limit 100 --json name --jq \
    '.[] | select(.name == "fork-sync") | .name')
  if [ -z "$label_exists" ]; then
    printf 'DRY_RUN: gh label create fork-sync --repo %s --color 1D76DB --description %s\n' \
      "$REPO" 'fork-sync failure tracking'
  fi

  existing_number=$(gh issue list \
    --repo "$REPO" \
    --state open \
    --label fork-sync \
    --limit 100 \
    --json number,title \
    --jq '.[] | [.number, .title] | @tsv' | \
    awk -F '\t' -v expected="$title" '$2 == expected { print $1; exit }')

  if [ -n "$existing_number" ]; then
    if [ "$STAGE" != sync-main ]; then
      printf 'DRY_RUN: gh issue comment %s --repo %s --title %s --body <generated-body>\n' \
        "$existing_number" "$REPO" "$title"
    fi
  else
    printf 'DRY_RUN: gh issue create --repo %s --title %s --body <generated-body> --label fork-sync\n' \
      "$REPO" "$title"
  fi
  exit 0
fi

label_exists=$(gh label list --repo "$REPO" --limit 100 --json name --jq \
  '.[] | select(.name == "fork-sync") | .name')
if [ -z "$label_exists" ]; then
  gh label create fork-sync \
    --repo "$REPO" \
    --color 1D76DB \
    --description 'fork-sync failure tracking'
fi

existing_number=$(gh issue list \
  --repo "$REPO" \
  --state open \
  --label fork-sync \
  --limit 100 \
  --json number,title \
  --jq '.[] | [.number, .title] | @tsv' | \
  awk -F '\t' -v expected="$title" '$2 == expected { print $1; exit }')

if [ -n "$existing_number" ]; then
  if [ "$STAGE" != sync-main ]; then
    gh issue comment "$existing_number" --repo "$REPO" --body "$body"
  fi
else
  gh issue create --repo "$REPO" --title "$title" --body "$body" --label fork-sync
fi
