#!/usr/bin/env bash
# Runs Claude Code inside tmux session `claude`, reports its Remote Control URL,
# and restarts it (resuming the conversation) when it exits. After 5 exits
# within 10 minutes it reports a fatal exit and stops restarting; the
# container stays up so the panel can inspect it.
set -uo pipefail

RUNNER=/opt/runner
REPO_DIR=/workspace/repo
STATE_DIR="$HOME/.runner"
mkdir -p "$STATE_DIR"

export CLAUDE_BIN="${CLAUDE_BIN:-claude}"
export RC_NAME="${RC_NAME:-${REPO_FULL_NAME##*/} · ${WORK_BRANCH}}"
export STARTING_TASK_FILE="$STATE_DIR/starting-task"
export CLAUDE_EXIT_FILE="$STATE_DIR/claude-exit-code"
export RESUME_MESSAGE_FILE="$STATE_DIR/resume-message"
# Written by the panel (after resume-message) to ask for an immediate relaunch.
RELAUNCH_MARKER="$STATE_DIR/panel-relaunch"
LAUNCH_STAMP="$STATE_DIR/launch-stamp"

default_url_regex='https://claude\.ai/code[/?][^[:space:]"<>'\'']*'
URL_REGEX="${URL_REGEX:-$default_url_regex}"
POLL_SECONDS=2
WINDOW_SECONDS=600
MAX_EXITS=5
BACKOFF=(5 15 45 120 300)
SCALE="${SUPERVISE_BACKOFF_SCALE:-1}"

report() { node "$RUNNER/bin/report-event.mjs" "$@" || true; }

# The starting task goes to a file, never through a shell string; run-claude.sh
# hands it to Claude as a single argv element. Only the first launch sends it.
if [ -e "$STATE_DIR/launched" ]; then
  mode=resume
else
  mode=first
  if [ -n "${STARTING_TASK_B64:-}" ]; then
    printf '%s' "$STARTING_TASK_B64" | base64 -d >"$STARTING_TASK_FILE" || {
      report boot_step "$(jq -nc '{step: "launch", status: "failed", error: "STARTING_TASK_B64 is not valid base64"}')"
      exit 1
    }
  fi
fi

last_url=""
poll_url() {
  local url
  url=$(tmux capture-pane -pJ -S -500 -t claude 2>/dev/null | grep -oE "$URL_REGEX" | tail -n 1) || true
  if [ -n "$url" ] && [ "$url" != "$last_url" ]; then
    last_url="$url"
    report remote_control_url "$(jq -nc --arg url "$url" '{url: $url}')"
  fi
}

exit_times=()
deliver_message=""
launch_reported=false
while true; do
  rm -f "$CLAUDE_EXIT_FILE"
  # A marker is only valid if the panel touched it after this stamp (i.e. during this launch).
  touch "$LAUNCH_STAMP"
  tmux new-session -d -s claude -x 220 -y 50 -c "$REPO_DIR" "$RUNNER/run-claude.sh" "$mode" $deliver_message
  touch "$STATE_DIR/launched"
  if [ "$launch_reported" = false ]; then
    report boot_step '{"step":"launch","status":"done"}'
    launch_reported=true
  fi

  while tmux has-session -t claude 2>/dev/null; do
    poll_url
    sleep "$POLL_SECONDS"
  done

  # A requested relaunch (marker newer than this launch's stamp, even if Claude had
  # already exited on its own) is consumed once: no exit_times entry, no backoff, and
  # the next launch delivers resume-message. An older marker is stale: drop it and
  # handle the exit as natural. resume-message is never deleted here; only a
  # requested launch reads it.
  deliver_message=""
  if [ -e "$RELAUNCH_MARKER" ]; then
    if [ "$RELAUNCH_MARKER" -nt "$LAUNCH_STAMP" ]; then
      rm -f "$RELAUNCH_MARKER"
      report claude_exited '{"code":0,"restarting":true,"fatal":false,"requested":true}'
      echo "supervise: relaunch requested by the panel" >&2
      mode=resume
      deliver_message=with-message
      continue
    fi
    rm -f "$RELAUNCH_MARKER"
  fi

  code=$(cat "$CLAUDE_EXIT_FILE" 2>/dev/null || echo 255)
  [[ "$code" =~ ^[0-9]+$ ]] || code=255
  now=$(date +%s)
  recent=()
  for t in "${exit_times[@]}" "$now"; do
    (( now - t < WINDOW_SECONDS )) && recent+=("$t")
  done
  exit_times=("${recent[@]}")
  count=${#exit_times[@]}

  if (( count >= MAX_EXITS )); then
    report claude_exited "$(jq -nc --argjson code "$code" '{code: $code, restarting: false, fatal: true}')"
    echo "supervise: Claude exited $count times within $((WINDOW_SECONDS / 60)) min; not restarting" >&2
    break
  fi
  report claude_exited "$(jq -nc --argjson code "$code" '{code: $code, restarting: true, fatal: false}')"
  delay=$(awk -v s="${BACKOFF[count - 1]}" -v k="$SCALE" 'BEGIN { printf "%.2f", s * k }')
  echo "supervise: Claude exited with $code; restarting in ${delay}s" >&2
  sleep "$delay"
  mode=resume
done

exec sleep infinity
