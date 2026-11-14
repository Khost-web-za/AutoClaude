#!/usr/bin/env bash
# Started by supervise.sh inside tmux. Usage: run-claude.sh first|resume [with-message]
# Launch command for Claude inside the session container.
set -uo pipefail

args=(--permission-mode "${PERMISSION_MODE:-auto}" --remote-control "$RC_NAME")

if [ "${1:-first}" = "resume" ]; then
  args=(--continue "${args[@]}")
  if [ "${2:-}" = with-message ] && [ -s "${RESUME_MESSAGE_FILE:-}" ]; then
    # Same byte-for-byte read as the starting task; delivered once, then deleted.
    message=$(cat "$RESUME_MESSAGE_FILE"; printf x)
    rm -f "$RESUME_MESSAGE_FILE"
    args+=(-- "${message%x}")
  fi
elif [ -s "$STARTING_TASK_FILE" ]; then
  # Read byte-for-byte (the trailing x keeps trailing newlines), pass as one argv element.
  task=$(cat "$STARTING_TASK_FILE"; printf x)
  args+=(-- "${task%x}")
fi

"$CLAUDE_BIN" "${args[@]}"
echo "$?" >"$CLAUDE_EXIT_FILE"
