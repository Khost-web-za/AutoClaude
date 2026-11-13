#!/usr/bin/env bash
# Started by supervise.sh inside tmux. Usage: run-claude.sh first|resume
# Launch command for Claude inside the session container.
set -uo pipefail

args=(--permission-mode "${PERMISSION_MODE:-auto}" --remote-control "$RC_NAME")

if [ "${1:-first}" = "resume" ]; then
  args=(--continue "${args[@]}")
elif [ -s "$STARTING_TASK_FILE" ]; then
  # Read byte-for-byte (the trailing x keeps trailing newlines), pass as one argv element.
  task=$(cat "$STARTING_TASK_FILE"; printf x)
  args+=(-- "${task%x}")
fi

"$CLAUDE_BIN" "${args[@]}"
echo "$?" >"$CLAUDE_EXIT_FILE"
