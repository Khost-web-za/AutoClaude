#!/usr/bin/env bash
# Stand-in for the claude CLI in integration tests (CLAUDE_BIN).
# Records argv NUL-separated (to STUB_ARGV_FILE, default /tmp/stub-argv). With STUB_EXIT set it exits
# with that code straight away (kick-off tests); otherwise it prints a Remote Control URL line and idles.
printf '%s\0' "$@" >"${STUB_ARGV_FILE:-/tmp/stub-argv}"
if [ -n "${STUB_EXIT:-}" ]; then
  exit "$STUB_EXIT"
fi
echo "Remote Control session: https://claude.ai/code/session_stub123"
exec sleep infinity
