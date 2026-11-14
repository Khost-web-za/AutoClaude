#!/usr/bin/env bash
# Session container boot (contract: docs/runner-contract.md).
# Runs as root only to start the inner dockerd, then re-execs itself as
# `claude`. Every step posts boot_step started/done/failed; a failure posts
# the error and exits 1.
set -uo pipefail

RUNNER=/opt/runner
REPO_DIR=/workspace/repo

report() { node "$RUNNER/bin/report-event.mjs" "$@" || true; }

step() { # step <name> <status> [error]
  local data
  if [ $# -ge 3 ]; then
    data=$(jq -nc --arg step "$1" --arg status "$2" --arg error "$3" '{step: $step, status: $status, error: $error}')
  else
    data=$(jq -nc --arg step "$1" --arg status "$2" '{step: $step, status: $status}')
  fi
  report boot_step "$data"
}

# Last lines of a command's output, with any credentials in URLs masked.
summarize() { tail -n 5 | sed -E 's#://[^/@[:space:]]+@#://***@#g'; }

fail() { # fail <step> <error>
  echo "boot: $1 failed: $2" >&2
  step "$1" failed "$2"
  exit 1
}

# --- as root ---------------------------------------------------------------
if [ "$(id -u)" = "0" ]; then
  if [ "${SESSION_DOCKER:-false}" = "true" ]; then
    step docker started
    dockerd >/var/log/dockerd.log 2>&1 &
    ready=false
    for _ in $(seq 1 30); do
      if docker info >/dev/null 2>&1; then ready=true; break; fi
      sleep 1
    done
    [ "$ready" = true ] || fail docker "dockerd did not become ready within 30 s: $(summarize </var/log/dockerd.log)"
    chgrp docker /var/run/docker.sock 2>/dev/null || true
    step docker done
  fi
  chown claude:claude /workspace /claude-auth 2>/dev/null || true
  exec gosu claude "$0" "$@"
fi

# --- as claude -------------------------------------------------------------
for var in REPO_FULL_NAME BASE_BRANCH WORK_BRANCH; do
  [ -n "${!var:-}" ] || fail clone "$var is not set"
done
export DEFAULT_BRANCH="${DEFAULT_BRANCH:-$BASE_BRANCH}"

git config --global user.name "${GIT_AUTHOR_NAME:-Claude}"
git config --global user.email "${GIT_AUTHOR_EMAIL:-noreply@anthropic.com}"
git config --global credential.helper "!node $RUNNER/bin/git-credential-panel.mjs"
git config --global init.defaultBranch main

if [ -d "$REPO_DIR/.git" ]; then
  echo "boot: existing workspace found, skipping clone and branch"
else
  step clone started
  url="${REPO_URL:-https://github.com/$REPO_FULL_NAME.git}"
  if ! out=$(git clone --branch "$BASE_BRANCH" -- "$url" "$REPO_DIR" 2>&1); then
    rm -rf "$REPO_DIR"
    fail clone "git clone of branch '$BASE_BRANCH' failed: $(printf '%s\n' "$out" | summarize)"
  fi
  if ! git -C "$REPO_DIR" rev-parse --verify -q HEAD >/dev/null; then
    rm -rf "$REPO_DIR"
    fail clone "repository has no commits on '$BASE_BRANCH'"
  fi
  step clone done

  step branch started
  if [ "${DELIVERY_MODE:-}" = "push" ]; then
    # Push mode works directly on the cloned base branch (already tracking origin/$BASE_BRANCH).
    [ "$WORK_BRANCH" = "$BASE_BRANCH" ] || fail branch "push mode needs WORK_BRANCH to equal BASE_BRANCH"
  else
    out=$(git -C "$REPO_DIR" switch -c "$WORK_BRANCH" 2>&1) || fail branch "git switch -c '$WORK_BRANCH' failed: $(printf '%s\n' "$out" | summarize)"
  fi
  step branch done
fi

step config started
out=$(node "$RUNNER/bin/assemble-home.mjs" --repo "$REPO_DIR" 2>&1) || fail config "$(printf '%s\n' "$out" | summarize)"
node "$RUNNER/bin/install-plugins.mjs" || echo "boot: plugin install reported problems (continuing)" >&2
step config done

step secrets started
out=$(node "$RUNNER/bin/write-secrets.mjs" --repo "$REPO_DIR" 2>&1) || fail secrets "$(printf '%s\n' "$out" | summarize)"
echo "$out"
step secrets done

step launch started
exec "$RUNNER/supervise.sh"
