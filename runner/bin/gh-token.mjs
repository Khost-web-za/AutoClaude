#!/usr/bin/env node
// Prints a short-lived GitHub token for the session repo, from the panel (spec
// call #3). Used by the `gh` wrapper (runner/gh-wrapper.sh) so `gh` never
// needs a stored login. Exits 1 with no stdout on failure.
import { panelRequest } from "../lib/panel-client.mjs";

try {
  const res = await panelRequest("POST", "/api/runner/git-credential", { repo: process.env.REPO_FULL_NAME }, { retries: 2, timeoutMs: 1_000 });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`panel responded ${res.status}`);
  }
  const { password } = await res.json();
  if (!password) throw new Error("panel returned no token");
  process.stdout.write(`${password}\n`);
} catch (err) {
  console.error(`gh-token: ${err.message}`);
  process.exitCode = 1;
}
