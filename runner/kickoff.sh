#!/usr/bin/env bash
# Window kick-off: runs real Claude Code once so a fresh 5-hour usage window starts.
# Short-lived container started by the panel; the shared credentials are linked from /claude-auth so a
# token refresh writes back to the volume. Prints nothing but a one-line exit status on failure.
set -uo pipefail

RUNNER="${RUNNER_DIR:-/opt/runner}"
export HOME="${KICKOFF_HOME:-$(mktemp -d)}"

if ! node "$RUNNER/bin/kickoff-home.mjs" --home "$HOME" --auth "${CLAUDE_AUTH_DIR:-/claude-auth}" >/dev/null 2>&1; then
  echo "kickoff: could not prepare the Claude home" >&2
  exit 1
fi

"${CLAUDE_BIN:-claude}" -p "." --model haiku >/dev/null 2>&1
code=$?
[ "$code" -eq 0 ] || echo "kickoff: claude exited with code $code" >&2
exit "$code"
