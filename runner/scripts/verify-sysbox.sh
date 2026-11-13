#!/usr/bin/env bash
# Verifies Docker-in-session under Sysbox on the VPS (see docs/vps-setup.md).
# Run on the VPS from the repo root:   bash runner/scripts/verify-sysbox.sh
# Prints "SYSBOX OK" or the first failing check. Cleans up everything it creates.
#
# Env overrides:
#   IMAGE           image to test (default: builds claudecloud-runner from ./runner)
#   RUNTIME         container runtime (default: sysbox-runc)
#   EXTRA_RUN_ARGS  extra `docker run` args — only for exercising this script
#                   locally without Sysbox (e.g. RUNTIME=runc EXTRA_RUN_ARGS=--privileged)
set -uo pipefail

IMAGE="${IMAGE:-}"
RUNTIME="${RUNTIME:-sysbox-runc}"
EXTRA_RUN_ARGS="${EXTRA_RUN_ARGS:-}"
SUFFIX="$$"
NET="claudecloud-verify-$SUFFIX"
PANEL="claudecloud-verify-panel-$SUFFIX"
SESSION="claudecloud-verify-session-$SUFFIX"

fail() {
  echo "SYSBOX FAILED: $*" >&2
  exit 1
}

cleanup() {
  docker rm -f -v "$SESSION" "$PANEL" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "== 1/7 runtime registered"
if [ "$RUNTIME" = "sysbox-runc" ]; then
  docker info --format '{{json .Runtimes}}' | grep -q '"sysbox-runc"' || fail "sysbox-runc is not a registered Docker runtime (see docs/vps-setup.md)"
fi

echo "== 2/7 image"
if [ -z "$IMAGE" ]; then
  IMAGE=claudecloud-runner
  docker build -q -t "$IMAGE" "$(dirname "$0")/.." >/dev/null || fail "docker build of runner image failed"
fi

host_before=$(docker ps -q --no-trunc | sort)
host_names=$(docker ps -a --format '{{.Names}}')

echo "== 3/7 start fake panel + session container ($RUNTIME)"
docker network create "$NET" >/dev/null || fail "could not create network $NET"
docker run -d --name "$PANEL" --network "$NET" --entrypoint node "$IMAGE" \
  /opt/runner/test/support/fake-panel-cli.mjs 3000 >/dev/null || fail "could not start fake panel"
# shellcheck disable=SC2086 # EXTRA_RUN_ARGS is intentionally word-split
docker run -d --name "$SESSION" --runtime="$RUNTIME" --network "$NET" $EXTRA_RUN_ARGS \
  -e SESSION_DOCKER=true \
  -e SESSION_ID=sess-1 -e SESSION_SECRET=secret-1 -e PANEL_URL="http://$PANEL:3000" \
  -e REPO_FULL_NAME=octocat/Hello-World -e BASE_BRANCH=master -e DEFAULT_BRANCH=master \
  -e WORK_BRANCH=claude/verify-sysbox \
  -e CLAUDE_BIN=/opt/runner/test/stub-claude.sh \
  "$IMAGE" >/dev/null || fail "could not start session container with runtime $RUNTIME"

echo "== 4/7 wait for boot"
booted=false
for _ in $(seq 1 120); do
  if docker exec "$SESSION" test -e /tmp/stub-argv 2>/dev/null; then booted=true; break; fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$SESSION" 2>/dev/null)" != "true" ]; then break; fi
  sleep 1
done
[ "$booted" = true ] || { docker logs "$SESSION" 2>&1 | tail -n 20 >&2; fail "session did not finish booting"; }

echo "== 5/7 docker run hello-world inside the session"
docker exec -u claude "$SESSION" docker run --rm hello-world >/dev/null 2>&1 || fail "inner 'docker run --rm hello-world' failed"

echo "== 6/7 docker compose inside the session"
docker exec -u claude "$SESSION" docker compose version >/dev/null 2>&1 || fail "inner 'docker compose version' failed"

echo "== 7/7 isolation from host Docker"
inner_names=$(docker exec -u claude "$SESSION" docker ps -a --format '{{.Names}}')
while IFS= read -r name; do
  [ -z "$name" ] && continue
  if printf '%s\n' "$inner_names" | grep -qxF "$name"; then
    fail "inner docker sees host container '$name'"
  fi
done <<<"$host_names"
docker exec "$SESSION" test -S /var/run/docker.sock || fail "inner docker socket missing"
host_after=$(docker ps -q --no-trunc | sort)
missing=$(comm -23 <(printf '%s\n' "$host_before") <(printf '%s\n' "$host_after"))
[ -z "$missing" ] || fail "host containers stopped during the check: $missing"

echo "SYSBOX OK"
