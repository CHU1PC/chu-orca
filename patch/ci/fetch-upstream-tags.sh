#!/usr/bin/env bash
set -euo pipefail

# Usage: fetch-upstream-tags.sh --url <url> [--remote <name>] [--tag <tag> ...]
# Adds or updates a read-only upstream remote and fetches release tags locally.

UPSTREAM_URL=${UPSTREAM_URL:-https://github.com/stablyai/orca.git}
REMOTE_NAME=${UPSTREAM_REMOTE_NAME:-upstream}
TAGS=

usage() {
  printf '%s\n' "Usage: $0 --url <url> [--remote <name>] [--tag <tag> ...]" >&2
  exit 64
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --url)
      [ "$#" -ge 2 ] || usage
      UPSTREAM_URL=$2
      shift 2
      ;;
    --remote)
      [ "$#" -ge 2 ] || usage
      REMOTE_NAME=$2
      shift 2
      ;;
    --tag)
      [ "$#" -ge 2 ] || usage
      if [ -n "$TAGS" ]; then
        TAGS="$TAGS
$2"
      else
        TAGS=$2
      fi
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

if git remote get-url "$REMOTE_NAME" >/dev/null 2>&1; then
  configured_url=$(git remote get-url "$REMOTE_NAME")
  if [ "$configured_url" != "$UPSTREAM_URL" ]; then
    printf 'remote %s already points to %s, expected %s\n' \
      "$REMOTE_NAME" "$configured_url" "$UPSTREAM_URL" >&2
    exit 1
  fi
else
  git remote add "$REMOTE_NAME" "$UPSTREAM_URL"
fi

if [ -z "$TAGS" ]; then
  git fetch --force --no-tags "$REMOTE_NAME" '+refs/tags/v*:refs/tags/v*'
else
  old_ifs=$IFS
  IFS='
'
  # The loop uses newline-delimited tag names so Bash 3.2 remains supported.
  for tag in $TAGS; do
    if ! [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      printf 'tag is not a stable release tag: %s\n' "$tag" >&2
      IFS=$old_ifs
      exit 2
    fi
    git fetch --force --no-tags "$REMOTE_NAME" "+refs/tags/$tag:refs/tags/$tag"
  done
  IFS=$old_ifs
fi
