#!/usr/bin/env bash
set -euo pipefail

# Usage: decide-sync.sh --old <tag> --new <tag> --open true|false
# Combines tag ordering and the open-issue guard, printing workflow outputs.

OLD_TAG=${OLD_TAG:-}
NEW_TAG=${NEW_TAG:-}
OPEN_ISSUE=${OPEN_ISSUE:-false}

usage() {
  printf '%s\n' "Usage: $0 --old <tag> --new <tag> --open true|false" >&2
  exit 64
}

while [ "$#" -gt 0 ]; do
  case "$1" in
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
    --open)
      [ "$#" -ge 2 ] || usage
      OPEN_ISSUE=$2
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

if ! [[ "$OLD_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || \
  ! [[ "$NEW_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  printf 'old and new must be stable release tags: %s %s\n' "$OLD_TAG" "$NEW_TAG" >&2
  exit 2
fi

case "$OPEN_ISSUE" in
  true|false) ;;
  *)
    printf 'open issue flag must be true or false: %s\n' "$OPEN_ISSUE" >&2
    exit 3
    ;;
esac

if [ "$OPEN_ISSUE" = true ]; then
  should_run=false
elif awk -v left="$NEW_TAG" -v right="$OLD_TAG" '
  BEGIN {
    sub(/^v/, "", left)
    sub(/^v/, "", right)
    split(left, l, ".")
    split(right, r, ".")
    if (l[1] + 0 > r[1] + 0 ||
        (l[1] + 0 == r[1] + 0 && l[2] + 0 > r[2] + 0) ||
        (l[1] + 0 == r[1] + 0 && l[2] + 0 == r[2] + 0 && l[3] + 0 > r[3] + 0)) {
      exit 0
    }
    exit 1
  }
'; then
  should_run=true
else
  should_run=false
fi

printf 'old=%s\n' "$OLD_TAG"
printf 'new=%s\n' "$NEW_TAG"
printf 'run=%s\n' "$should_run"
