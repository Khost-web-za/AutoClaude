#!/usr/bin/env bash
# Stand-in for the claude CLI in integration tests (CLAUDE_BIN).
# Records argv NUL-separated, prints a Remote Control URL line, then idles.
printf '%s\0' "$@" >/tmp/stub-argv
if [ "${STUB_EXIT:-0}" = "1" ]; then
  exit 1
fi
echo "Remote Control session: https://claude.ai/code/session_stub123"
exec sleep infinity
