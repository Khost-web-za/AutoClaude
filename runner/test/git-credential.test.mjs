import { test } from "node:test";
import assert from "node:assert/strict";
import { startFakePanel } from "./support/fake-panel.mjs";
import { runCli } from "./support/run-cli.mjs";

const panelEnv = (url) => ({ PANEL_URL: url, SESSION_ID: "sess-1", SESSION_SECRET: "secret-1", REPO_FULL_NAME: "octo/demo" });
const githubInput = "protocol=https\nhost=github.com\npath=octo/demo.git\n\n";

test("prints credentials for github.com", async () => {
  const panel = await startFakePanel({ credential: { username: "x-access-token", password: "ghs_abc", expiresAt: "2030-01-01T00:00:00Z" } });
  try {
    const res = await runCli("git-credential-panel.mjs", ["get"], { env: panelEnv(panel.url), stdin: githubInput });
    assert.equal(res.code, 0, res.stderr);
    assert.equal(res.stdout, "username=x-access-token\npassword=ghs_abc\n");
    const req = panel.requests.find((r) => r.path === "/api/runner/git-credential");
    assert.deepEqual(JSON.parse(req.body), { repo: "octo/demo" });
  } finally {
    await panel.close();
  }
});

test("ignores other hosts", async () => {
  const panel = await startFakePanel();
  try {
    const res = await runCli("git-credential-panel.mjs", ["get"], {
      env: panelEnv(panel.url),
      stdin: "protocol=https\nhost=gitlab.com\n\n",
    });
    assert.equal(res.code, 0);
    assert.equal(res.stdout, "");
    assert.equal(panel.requests.length, 0);
  } finally {
    await panel.close();
  }
});

test("exits 1 fast when panel down", async () => {
  const panel = await startFakePanel({ down: true });
  try {
    const res = await runCli("git-credential-panel.mjs", ["get"], { env: panelEnv(panel.url), stdin: githubInput });
    assert.equal(res.code, 1);
    assert.equal(res.stdout, "");
    assert.ok(res.ms < 3_000, `took ${res.ms} ms`);
  } finally {
    await panel.close();
  }
});

test("exits 1 when panel rejects the session", async () => {
  const panel = await startFakePanel();
  try {
    const res = await runCli("git-credential-panel.mjs", ["get"], {
      env: { ...panelEnv(panel.url), SESSION_SECRET: "wrong" },
      stdin: githubInput,
    });
    assert.equal(res.code, 1);
    assert.equal(res.stdout, "");
  } finally {
    await panel.close();
  }
});

test("store and erase are no-ops", async () => {
  const panel = await startFakePanel();
  try {
    for (const op of ["store", "erase"]) {
      const res = await runCli("git-credential-panel.mjs", [op], {
        env: panelEnv(panel.url),
        stdin: githubInput + "username=x\npassword=y\n",
      });
      assert.equal(res.code, 0);
      assert.equal(res.stdout, "");
    }
    assert.equal(panel.requests.length, 0);
  } finally {
    await panel.close();
  }
});
