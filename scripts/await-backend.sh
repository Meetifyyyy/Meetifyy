#!/usr/bin/env bash
#
# Vercel ignoreCommand: ship the frontend only once the API is on this commit.
#
# The frontend and the API come from one repository through two independent
# pipelines — a GitHub Action builds and rolls out the container, Vercel builds
# the bundle — and nothing coordinated them. Vercel is much the faster of the
# two (a Vite build against a Docker build, a migration job and a container
# rollout), so on a push to main the frontend reached users first. That is the
# one order that hurts: a bundle expecting cookie sessions, served against an
# API that does not issue them yet, signs everybody out until the backend lands.
#
# Vercel's contract is inverted, which is worth stating because it reads wrong:
#   exit 0  -> SKIP the build
#   exit 1  -> RUN the build
#
# So the safe default is exit 0. If the API never catches up we simply do not
# ship: production keeps the previous bundle, which works against the new API
# because the backend still accepts the old bearer path. A stale frontend is a
# recoverable state; a signed-out user base is not.
#
# Commits touching only frontend files skip the wait entirely — there is no
# backend deploy to wait for, and blocking on one would never finish.

set -uo pipefail

API_URL="${AWAIT_BACKEND_URL:-https://api.meetifyy.app}"
TIMEOUT_SECONDS="${AWAIT_BACKEND_TIMEOUT:-900}"
POLL_SECONDS="${AWAIT_BACKEND_INTERVAL:-10}"
SHA="${VERCEL_GIT_COMMIT_SHA:-}"

say() { echo "[await-backend] $*" >&2; }

if [ -z "$SHA" ]; then
  say "No commit SHA in the environment — cannot tell what to wait for. Building."
  exit 1
fi

# Does this commit change the backend at all? If not, no container deploy is
# coming and waiting for one would time out on every frontend-only change.
if git rev-parse --verify HEAD~1 >/dev/null 2>&1; then
  if ! git diff --name-only HEAD~1 HEAD | grep -qE '^backend/'; then
    say "No backend changes in $SHA — nothing to wait for. Building."
    exit 1
  fi
fi

say "Waiting for $API_URL to report commit $SHA (up to ${TIMEOUT_SECONDS}s)."

deadline=$(( $(date +%s) + TIMEOUT_SECONDS ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  live=$(curl -fsS --max-time 10 "$API_URL/health/" 2>/dev/null \
    | sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

  if [ "$live" = "$SHA" ]; then
    say "API is on $SHA. Building."
    exit 1
  fi

  # An API that reports no commit predates this mechanism. Waiting for a field
  # it will never send would block every deploy, so treat it as "cannot tell"
  # and ship — the situation this guards against needs a NEW backend anyway.
  if [ -z "$live" ]; then
    say "API reports no commit (older build or unreachable). Building."
    exit 1
  fi

  say "API is on ${live:0:8}, waiting for ${SHA:0:8}…"
  sleep "$POLL_SECONDS"
done

say "Timed out after ${TIMEOUT_SECONDS}s. Skipping this build so the current"
say "frontend keeps serving; redeploy once the API is up."
exit 0
