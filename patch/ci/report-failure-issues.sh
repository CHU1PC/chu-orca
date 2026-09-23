#!/usr/bin/env bash
set -euo pipefail

# Usage: MODE=check|rebase report-failure-issues.sh
# Reports failed workflow stages and preserves the job failure for blocking stages.

MODE=${MODE:-}
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
REPO=${REPO:-}
TARGET_TAG=${TARGET_TAG:-unknown}
OLD_TAG=${OLD_TAG:-unknown}
NEW_TAG=${NEW_TAG:-unknown}
RUN_URL=${RUN_URL:-}
issue_failure=0
blocking_failure=0

if [ -z "$REPO" ]; then
  printf '%s\n' 'REPO is not set; pass --repo or set REPO' >&2
  exit 1
fi

report_stage() {
  stage=$1
  outcome=$2
  details=$3
  details_file=$4

  if [ "$outcome" != failure ]; then
    return 0
  fi

  if [ -n "$details_file" ]; then
    if ! REPO="$REPO" RUN_URL="$RUN_URL" "$SCRIPT_DIR/open-failure-issue.sh" --tag "$TARGET_TAG" --stage "$stage" \
      --old "$OLD_TAG" --new "$NEW_TAG" --details "$details" --details-file "$details_file"; then
      issue_failure=1
    fi
  elif ! REPO="$REPO" RUN_URL="$RUN_URL" "$SCRIPT_DIR/open-failure-issue.sh" --tag "$TARGET_TAG" --stage "$stage" \
    --old "$OLD_TAG" --new "$NEW_TAG" --details "$details"; then
    issue_failure=1
  fi

  if [ "$stage" != sync-main ]; then
    blocking_failure=1
  fi
}

case "$MODE" in
  check)
    report_stage sync-main "${SYNC_MAIN_OUTCOME:-}" \
      'synchronizing the fork main branch failed' ''
    report_stage fetch-tags "${FETCH_TAGS_OUTCOME:-}" \
      'fetching upstream release tags failed' ''
    report_stage detect-target-tag "${DETECT_TARGET_OUTCOME:-}" \
      'detecting the target or current base tag failed' ''
    report_stage check-open-issue "${CHECK_OPEN_ISSUE_OUTCOME:-}" \
      'checking open fork-sync issues failed' ''
    report_stage decide-sync "${DECIDE_SYNC_OUTCOME:-}" \
      'combining the tag and issue decisions failed' ''
    ;;
  rebase)
    report_stage rebase "${FETCH_REBASE_OUTCOME:-}" \
      'fetching the old and new upstream tags failed' ''
    report_stage rebase "${REBASE_IDENTITY_OUTCOME:-}" \
      'configuring the GitHub Actions commit identity failed' ''
    report_stage rebase "${REBASE_OUTCOME:-}" \
      'rebasing patched onto the new release tag failed' "${CONFLICTS_FILE:-}"
    report_stage install "${SETUP_NODE_OUTCOME:-}" \
      'setting up Node.js failed' ''
    report_stage install "${INSTALL_OUTCOME:-}" \
      'pnpm install --frozen-lockfile failed' ''
    report_stage typecheck "${TYPECHECK_OUTCOME:-}" \
      'pnpm tc failed' ''
    report_stage test "${TEST_OUTCOME:-}" \
      'the focused test suite failed' ''
    report_stage quality "${QUALITY_OUTCOME:-}" \
      'the changed-code quality gate failed' ''
    report_stage package "${PACKAGE_OUTCOME:-}" \
      'unsigned release packaging or app assertion failed' ''
    report_stage push "${PUSH_OUTCOME:-}" \
      'force-with-lease push to the fork failed' ''
    ;;
  *)
    printf 'MODE must be check or rebase: %s\n' "$MODE" >&2
    exit 64
    ;;
esac

if [ "$issue_failure" -ne 0 ] || [ "$blocking_failure" -ne 0 ]; then
  exit 1
fi
