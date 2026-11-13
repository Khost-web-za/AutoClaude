import { test } from "node:test";
import assert from "node:assert/strict";
import { startFakePanel } from "./support/fake-panel.mjs";
import { runCli } from "./support/run-cli.mjs";

const panelEnv = (url) => ({ PANEL_URL: url, SESSION_ID: "sess-1", SESSION_SECRET: "secret-1", REPO_FULL_NAME: "octo/demo" });

test("prints the panel's GitHub token for the session repo", async () => {
  const panel = await startFakePanel({ credential: { username: "x-access-token", password: "ghs_for_gh", expiresAt: "2030-01-01T00:00:00Z" } });
  try {
    const res = await runCli("gh-token.mjs", [], { env: panelEnv(panel.url) });
    assert.equal(res.code, 0, res.stderr);
    assert.equal(res.stdout, "ghs_for_gh\n");
    assert.deepEqual(JSON.parse(panel.requests[0].body), { repo: "octo/demo" });
  } finally {
    await panel.close();
  }
});

test("exits 1 fast with no output when the panel is down", async () => {
  const panel = await startFakePanel({ down: true });
  try {
    const res = await runCli("gh-token.mjs", [], { env: panelEnv(panel.url) });
    assert.equal(res.code, 1);
    assert.equal(res.stdout, "");
    assert.ok(res.ms < 3_000, `took ${res.ms} ms`);
  } finally {
    await panel.close();
  }
});
