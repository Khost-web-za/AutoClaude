#!/usr/bin/env bash
# Installed as /usr/local/bin/gh (ahead of /usr/bin/gh on PATH): fetches a fresh
# token from the panel for each invocation, unless GH_TOKEN is already set.
if [ -z "${GH_TOKEN:-}" ]; then
  GH_TOKEN=$(node /opt/runner/bin/gh-token.mjs) || {
    echo "gh: could not get a GitHub token from the panel" >&2
    exit 1
  }
  export GH_TOKEN
fi
exec /usr/bin/gh "$@"
