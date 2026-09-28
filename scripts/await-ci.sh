#!/usr/bin/env bash
#
# Deploy gate: wait for CI's `validate` check on this commit, and fail unless
# it passed.
#
# The deploy workflows and CI start from the same push and run independently,
# so a commit whose tests failed was still built, migrated and rolled out —
# this happened on development on 2026-09-28 (62d0d086: CI failed, deploy
# succeeded). `validate` is CI's single aggregate check; it always reports,
# pass or fail, so waiting on it cannot deadlock.
#
# A commit can carry more than one `validate` run (a push run and a pull
# request run). Every one of them must finish, and every one must pass.
#
# Usage: scripts/await-ci.sh <sha>
#   GITHUB_REPOSITORY  owner/repo (set by Actions)
#   GH_TOKEN           token with checks:read (set by the workflow)
#   AWAIT_CI_TIMEOUT   seconds before giving up (default 1800)
#   AWAIT_CI_INTERVAL  seconds between polls (default 15)
#   AWAIT_CI_CHECK     check name (default validate)

set -uo pipefail

SHA="${1:?usage: await-ci.sh <sha>}"
REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is not set}"
TIMEOUT_SECONDS="${AWAIT_CI_TIMEOUT:-1800}"
POLL_SECONDS="${AWAIT_CI_INTERVAL:-15}"
CHECK="${AWAIT_CI_CHECK:-validate}"

deadline=$(( $(date +%s) + TIMEOUT_SECONDS ))
echo "Waiting for '${CHECK}' on ${SHA} (up to ${TIMEOUT_SECONDS}s)"

while :; do
  # One line per run: "<status> <conclusion>".
  if runs=$(gh api "repos/${REPO}/commits/${SHA}/check-runs?check_name=${CHECK}&per_page=100" \
      --jq '.check_runs[] | "\(.status) \(.conclusion // "none")"'); then
    total=$(printf '%s\n' "$runs" | grep -c . || true)
    pending=$(printf '%s\n' "$runs" | grep . | grep -vc '^completed ' || true)
    failed=$(printf '%s\n' "$runs" | grep '^completed ' | grep -vc ' success$' || true)

    if [ "$total" -gt 0 ] && [ "$failed" -gt 0 ]; then
      echo "::error::CI '${CHECK}' did not pass for ${SHA}; not deploying."
      printf '%s\n' "$runs"
      exit 1
    fi
    if [ "$total" -gt 0 ] && [ "$pending" -eq 0 ]; then
      echo "CI '${CHECK}' passed for ${SHA} (${total} run(s))."
      exit 0
    fi
    echo "  ${total} run(s), ${pending} still running"
  else
    echo "  check-runs lookup failed; retrying"
  fi

  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "::error::Timed out waiting for CI '${CHECK}' on ${SHA}; not deploying."
    exit 1
  fi
  sleep "$POLL_SECONDS"
done
