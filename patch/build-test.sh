#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BRANCH=$(git -C "$ROOT" branch --show-current)
if [ "$BRANCH" != 'patched-test' ]; then
  printf '%s\n' "build-test.sh must run on the patched-test branch (current: $BRANCH)" >&2
  exit 1
fi
STATUS=$(git -C "$ROOT" status --porcelain)
if [ -n "$STATUS" ]; then
  printf '%s\n' 'build-test.sh requires a clean Git worktree:' >&2
  printf '%s\n' "$STATUS" >&2
  exit 1
fi
export PATH="$ROOT/patch:$PATH"
export ORCA_PATCHED_FLAVOR=test
CHECK_ONLY=0
for ARG in "$@"; do
  if [ "$ARG" = "--check-only" ]; then
    CHECK_ONLY=1
  fi
done
if [ "$CHECK_ONLY" -eq 1 ]; then
  printf '%s\n' 'build-test guard passed'
  exit 0
fi
# 起動中のままビルドすると、置き換え途中の壊れた app が残る
APP_PATH="$ROOT/dist/mac-arm64/Orca-Patch.app"
RUNNING_PIDS=''
for PID in $(pgrep -f "$APP_PATH" 2>/dev/null || true); do
  if [ "$PID" != "$$" ] && [ "$PID" != "$PPID" ]; then
    RUNNING_PIDS="$RUNNING_PIDS $PID"
  fi
done
if [ -n "$RUNNING_PIDS" ]; then
  printf '%s\n' 'Orca-Patch is running. Quit it before building:' >&2
  printf '%s\n' "  pkill -f '$APP_PATH'" >&2
  exit 1
fi
# Finder が作る .DS_Store が残ると electron-builder が出力先を消せない
cd "$ROOT"
rm -rf "$ROOT/dist/mac-arm64" "$ROOT/dist/mac-arm64.tmp"
pnpm run build:unpack "$@"
APP_PATH=$(find "$ROOT/dist" -maxdepth 3 -name '*.app' -print -quit)
if [ -z "$APP_PATH" ]; then
  printf '%s\n' 'テスト用ビルドの app が見つかりません' >&2
  exit 1
fi
IDENTIFIER=$(/usr/libexec/PlistBuddy -c 'Print:CFBundleIdentifier' "$APP_PATH/Contents/Info.plist")
printf 'CFBundleIdentifier=%s\n' "$IDENTIFIER"
if [ "$IDENTIFIER" != 'com.chu1.orca-patch' ]; then
  printf '%s\n' 'テスト用ビルドの CFBundleIdentifier が不正です' >&2
  exit 1
fi
