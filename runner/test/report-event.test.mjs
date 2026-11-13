import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startFakePanel } from "./support/fake-panel.mjs";
import { postEvent } from "../lib/panel-client.mjs";

const REPORT_EVENT = fileURLToPath(new URL("../bin/report-event.mjs", import.meta.url));

function useEnv(url) {
  process.env.PANEL_URL = url;
  process.env.SESSION_ID = "sess-1";
  process.env.SESSION_SECRET = "secret-1";
}

function runCli(args, { env, stdin = "" }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [REPORT_EVENT, ...args], { env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

test("posts event with auth headers", async () => {
  const panel = await startFakePanel();
  try {
    useEnv(panel.url);
    const ok = await postEvent("boot_step", { step: "clone", status: "done" });
    assert.equal(ok, true);
    assert.equal(panel.events.length, 1);
    assert.equal(panel.events[0].type, "boot_step");
    assert.deepEqual(panel.events[0].data, { step: "clone", status: "done" });
    assert.ok(!Number.isNaN(Date.parse(panel.events[0].at)));
    const req = panel.requests.at(-1);
    assert.equal(req.headers.authorization, "Bearer secret-1");
    assert.equal(req.headers["x-session-id"], "sess-1");
  } finally {
    await panel.close();
  }
});

test("retries then succeeds", async () => {
  const panel = await startFakePanel({ failFirst: 2 });
  try {
    useEnv(panel.url);
    const ok = await postEvent("boot_step", { step: "clone", status: "started" });
    assert.equal(ok, true);
    assert.equal(panel.events.length, 1);
    assert.equal(panel.requests.length, 3);
  } finally {
    await panel.close();
  }
});

test("gives up without throwing when panel is down", async () => {
  const panel = await startFakePanel({ down: true });
  try {
    useEnv(panel.url);
    const started = Date.now();
    const ok = await postEvent("boot_step", { step: "clone", status: "started" });
    assert.equal(ok, false);
    assert.ok(Date.now() - started < 11_000, `took ${Date.now() - started} ms`);
    assert.equal(panel.events.length, 0);
  } finally {
    await panel.close();
  }
});

test("rejects requests without the session secret", async () => {
  const panel = await startFakePanel();
  try {
    useEnv(panel.url);
    process.env.SESSION_SECRET = "wrong";
    const ok = await postEvent("boot_step", { step: "clone", status: "done" });
    assert.equal(ok, false);
    assert.equal(panel.events.length, 0);
  } finally {
    await panel.close();
  }
});

test("hook mode forwards only event name and message", async () => {
  const panel = await startFakePanel();
  try {
    const stdin = JSON.stringify({
      hook_event_name: "Notification",
      message: "Claude needs your input",
      transcript_path: "/x",
      tool_input: { secret: "s3cr3t" },
    });
    const res = await runCli(["hook"], {
      env: { PANEL_URL: panel.url, SESSION_ID: "sess-1", SESSION_SECRET: "secret-1" },
      stdin,
    });
    assert.equal(res.code, 0, res.stderr);
    assert.equal(panel.events.length, 1);
    assert.equal(panel.events[0].type, "hook");
    assert.deepEqual(panel.events[0].data, { event: "Notification", message: "Claude needs your input" });
    assert.ok(!JSON.stringify(panel.requests).includes("s3cr3t"));
  } finally {
    await panel.close();
  }
});

test("cli posts typed event with json data", async () => {
  const panel = await startFakePanel();
  try {
    const res = await runCli(["remote_control_url", '{"url":"https://claude.ai/code/x"}'], {
      env: { PANEL_URL: panel.url, SESSION_ID: "sess-1", SESSION_SECRET: "secret-1" },
    });
    assert.equal(res.code, 0, res.stderr);
    assert.deepEqual(panel.events[0], { type: "remote_control_url", data: { url: "https://claude.ai/code/x" }, at: panel.events[0].at });
  } finally {
    await panel.close();
  }
});

test("hook mode gives up fast when panel is down", async () => {
  const panel = await startFakePanel({ down: true });
  try {
    const started = Date.now();
    const res = await runCli(["hook"], {
      env: { PANEL_URL: panel.url, SESSION_ID: "sess-1", SESSION_SECRET: "secret-1" },
      stdin: JSON.stringify({ hook_event_name: "UserPromptSubmit" }),
    });
    assert.equal(res.code, 0);
    assert.ok(Date.now() - started < 3_000, `took ${Date.now() - started} ms`);
  } finally {
    await panel.close();
  }
});
