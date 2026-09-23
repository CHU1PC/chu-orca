#!/usr/bin/env bash
set -euo pipefail

# Usage: detect-target-tag.sh [--upstream <remote-or-url>] [--branch <ref>] [--tag <tag>]
# Prints old= and new= lines for a local Git branch and an upstream release tag.

UPSTREAM_REMOTE=${UPSTREAM_REMOTE:-origin}
BRANCH_REF=${BRANCH_REF:-HEAD}
FORCED_TAG=${FORCED_TAG:-}

usage() {
  printf '%s\n' "Usage: $0 [--upstream <remote-or-url>] [--branch <ref>] [--tag <tag>]" >&2
  exit 64
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --upstream)
      [ "$#" -ge 2 ] || usage
      UPSTREAM_REMOTE=$2
      shift 2
      ;;
    --branch)
      [ "$#" -ge 2 ] || usage
      BRANCH_REF=$2
      shift 2
      ;;
    --tag)
      [ "$#" -ge 2 ] || usage
      FORCED_TAG=$2
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

release_tag_pattern='^v[0-9]+\.[0-9]+\.[0-9]+$'
branch_sha=$(git rev-parse --verify "${BRANCH_REF}^{commit}") || {
  printf 'branch ref does not resolve to a commit: %s\n' "$BRANCH_REF" >&2
  exit 1
}

remote_tags=$(git ls-remote --tags --refs "$UPSTREAM_REMOTE")

if [ -n "$FORCED_TAG" ]; then
  if ! [[ "$FORCED_TAG" =~ $release_tag_pattern ]]; then
    printf 'forced tag is not a stable release tag: %s\n' "$FORCED_TAG" >&2
    exit 2
  fi
  if ! printf '%s\n' "$remote_tags" | awk -F '\t' -v expected="refs/tags/$FORCED_TAG" \
    '$2 == expected { found = 1 } END { exit(found ? 0 : 1) }'; then
    printf 'forced tag does not exist upstream: %s\n' "$FORCED_TAG" >&2
    exit 3
  fi
  target_tag=$FORCED_TAG
else
  target_tag=$(printf '%s\n' "$remote_tags" | awk -F '\t' '
    $2 ~ /^refs\/tags\/v[0-9]+\.[0-9]+\.[0-9]+$/ {
      tag = $2
      sub(/^refs\/tags\//, "", tag)
      version = tag
      sub(/^v/, "", version)
      count = split(version, part, ".")
      if (count == 3 && (!found || part[1] + 0 > best[1] + 0 ||
          (part[1] + 0 == best[1] + 0 && part[2] + 0 > best[2] + 0) ||
          (part[1] + 0 == best[1] + 0 && part[2] + 0 == best[2] + 0 &&
           part[3] + 0 > best[3] + 0))) {
        best[1] = part[1]
        best[2] = part[2]
        best[3] = part[3]
        best_tag = tag
        found = 1
      }
    }
    END {
      if (found) {
        print best_tag
      } else {
        exit 1
      }
    }
  ') || {
    printf '%s\n' 'no stable upstream release tag was found' >&2
    exit 4
  }
fi

base_tag=
while IFS= read -r candidate; do
  [ -n "$candidate" ] || continue
  if ! [[ "$candidate" =~ $release_tag_pattern ]]; then
    continue
  fi
  if git merge-base --is-ancestor "refs/tags/$candidate" "$branch_sha"; then
    base_tag=$candidate
  fi
done < <(git for-each-ref --sort=v:refname --format='%(refname:strip=2)' refs/tags)

if [ -z "$base_tag" ]; then
  printf 'no stable release tag is an ancestor of %s\n' "$BRANCH_REF" >&2
  exit 5
fi

printf 'old=%s\n' "$base_tag"
printf 'new=%s\n' "$target_tag"
