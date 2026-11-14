import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, readlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assembleHome } from "../lib/assemble-home.mjs";

const configDir = fileURLToPath(new URL("./fixtures/session-config", import.meta.url));
const overlayDir = fileURLToPath(new URL("../overlay", import.meta.url));

async function assemble(extraVars = {}) {
  const root = mkdtempSync(join(tmpdir(), "home-"));
  const homeDir = join(root, "home");
  const authDir = join(root, "auth");
  mkdirSync(authDir);
  const repoDir = "/workspace/repo";
  await assembleHome({ configDir, overlayDir, homeDir, repoDir, authDir, vars: { WORK_BRANCH: "claude/fix-a1b2", DEFAULT_BRANCH: "main", ...extraVars } });
  const settings = JSON.parse(readFileSync(join(homeDir, ".claude", "settings.json"), "utf8"));
  const sessionSettings = JSON.parse(readFileSync(join(overlayDir, "settings.session.json"), "utf8"));
  const md = readFileSync(join(homeDir, ".claude", "CLAUDE.md"), "utf8");
  return { homeDir, authDir, repoDir, settings, sessionSettings, md };
}

test("copies skills", async () => {
  const { homeDir } = await assemble();
  assert.ok(existsSync(join(homeDir, ".claude", "skills", "demo", "SKILL.md")));
  assert.equal(existsSync(join(homeDir, ".claude", "README.md")), false);
});

test("strips permissions and windows paths from user settings", async () => {
  const { settings } = await assemble();
  assert.equal(settings.apiKeyHelper, undefined);
  assert.equal(settings.statusLine, undefined);
  assert.equal(settings.hooks.PostToolUse?.some((m) => JSON.stringify(m).includes("fmt.exe")) ?? false, false);
  assert.ok(!JSON.stringify(settings).match(/[A-Za-z]:\\\\/));
  assert.equal(settings.model, "opus");
  assert.deepEqual(settings.enabledPlugins, { "superpowers@claude-plugins-official": true });
});

test("session permissions replace user permissions", async () => {
  const { settings, sessionSettings } = await assemble();
  assert.deepEqual(settings.permissions, sessionSettings.permissions);
});

test("hooks are concatenated with session hooks last", async () => {
  const { settings } = await assemble();
  const stop = settings.hooks.Stop.flatMap((m) => m.hooks.map((h) => h.command));
  assert.equal(stop[0], "echo user-stop");
  assert.equal(stop.at(-1), "node /opt/runner/bin/report-event.mjs hook");
  const pre = settings.hooks.PreToolUse;
  assert.equal(pre.at(-1).matcher, "Bash");
  assert.equal(pre.at(-1).hooks[0].command, "node /opt/runner/bin/guard-push.mjs");
  for (const event of ["SessionStart", "UserPromptSubmit", "Notification"]) {
    assert.equal(settings.hooks[event].at(-1).hooks[0].command, "node /opt/runner/bin/report-event.mjs hook");
  }
});

test("CLAUDE.md has user content then session content", async () => {
  const { homeDir } = await assemble();
  const md = readFileSync(join(homeDir, ".claude", "CLAUDE.md"), "utf8");
  assert.ok(md.startsWith("# User instructions\n\nUse Tailwind.\n\n\n"));
  assert.ok(md.indexOf("Use Tailwind.") < md.indexOf("disposable container"));
  assert.ok(md.includes("claude/fix-a1b2"));
  assert.ok(!md.includes("${WORK_BRANCH}"));
});

test("push mode writes the push rules and no PR instruction", async () => {
  const { md } = await assemble({ DELIVERY_MODE: "push", WORK_BRANCH: "main" });
  assert.ok(md.includes("there is no pull request"));
  assert.ok(md.includes("work directly on `main`"));
  assert.ok(!md.includes("open a pull request against"));
  assert.ok(!md.includes("${"));
});

test("default mode keeps the PR rules", async () => {
  const { md } = await assemble();
  assert.ok(md.includes("open a pull request"));
  assert.ok(md.includes("Never push to the default branch `main`"));
  assert.ok(!md.includes("there is no pull request"));
});

test("credentials link points into authDir", { skip: process.platform === "win32" && "symlinks need privileges on Windows" }, async () => {
  const { homeDir, authDir } = await assemble();
  assert.equal(readlinkSync(join(homeDir, ".claude", ".credentials.json")), join(authDir, ".credentials.json"));
});

test(".claude.json trusts repoDir", async () => {
  const { homeDir, repoDir } = await assemble();
  const state = JSON.parse(readFileSync(join(homeDir, ".claude.json"), "utf8"));
  assert.equal(state.hasCompletedOnboarding, true);
  assert.equal(state.projects[repoDir].hasTrustDialogAccepted, true);
});

test("re-running keeps existing .claude.json state", async () => {
  const root = mkdtempSync(join(tmpdir(), "home-"));
  const homeDir = join(root, "home");
  mkdirSync(homeDir, { recursive: true });
  writeFileSync(join(homeDir, ".claude.json"), JSON.stringify({ userID: "keep-me", projects: { "/other": { x: 1 } } }));
  await assembleHome({ configDir, overlayDir, homeDir, repoDir: "/workspace/repo", authDir: root, vars: {} });
  const state = JSON.parse(readFileSync(join(homeDir, ".claude.json"), "utf8"));
  assert.equal(state.userID, "keep-me");
  assert.deepEqual(state.projects["/other"], { x: 1 });
  assert.equal(state.projects["/workspace/repo"].hasTrustDialogAccepted, true);
});

test("never copies a credentials file from the config dir", async () => {
  const root = mkdtempSync(join(tmpdir(), "home-"));
  const cfg = join(root, "cfg");
  mkdirSync(cfg);
  writeFileSync(join(cfg, ".credentials.json"), "LEAKED");
  const homeDir = join(root, "home");
  const authDir = join(root, "auth");
  await assembleHome({ configDir: cfg, overlayDir, homeDir, repoDir: "/workspace/repo", authDir, vars: {} });
  const cred = join(homeDir, ".claude", ".credentials.json");
  if (process.platform === "win32") assert.equal(existsSync(cred), false);
  else assert.equal(readlinkSync(cred), join(authDir, ".credentials.json"));
});
