#!/usr/bin/env bash

failure_issue_title() {
  if [ "$#" -ne 2 ]; then
    printf '%s\n' 'failure_issue_title requires a tag and stage' >&2
    return 64
  fi

  printf 'fork-sync failed: %s (%s)\n' "$1" "$2"
}
