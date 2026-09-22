#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BRANCH=$(git -C "$ROOT" branch --show-current)
if [ "$BRANCH" != 'patched' ]; then
  printf '%s\n' "build-release.sh must run on the patched branch (current: $BRANCH)" >&2
  exit 1
fi
STATUS=$(git -C "$ROOT" status --porcelain)
if [ -n "$STATUS" ]; then
  printf '%s\n' 'build-release.sh requires a clean Git worktree:' >&2
  printf '%s\n' "$STATUS" >&2
  exit 1
fi
export PATH="$ROOT/patch:$PATH"
export ORCA_PATCHED_FLAVOR=release
if [ "${1-}" = "--check-only" ]; then
  printf '%s\n' 'build-release guard passed'
  exit 0
fi
# Finder が作る .DS_Store が残ると electron-builder が出力先を消せない
cd "$ROOT"
rm -rf "$ROOT/dist/mac-arm64" "$ROOT/dist/mac-arm64.tmp"
exec pnpm run build:unpack "$@"
