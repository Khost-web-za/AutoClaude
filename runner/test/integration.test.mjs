// Integration tests for the runner image. Opt-in: RUNNER_IT=1 npm test
// Builds `claudecloud-runner`, runs containers against a fake panel on the host
// and bare repos mounted at /repos, with the stub in place of Claude.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { startFakePanel } from "./support/fake-panel.mjs";
import { makeBareRepos } from "./support/make-bare-repo.mjs";

const enabled = process.env.RUNNER_IT === "1";
const IMAGE = "claudecloud-runner:test";
const RUNNER_DIR = fileURLToPath(new URL("..", import.meta.url));
const STARTING_TASK = 'He said "hi" $HOME `id` \\n line2\n line3 🚀 \'single\' && rm -rf /';

const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = check();
    if (value) return value;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${label}`);
}

let reposDir;
const containers = [];
const panels = [];

async function startSession(env = {}, panelOpts = {}) {
  const panel = await startFakePanel({ host: "0.0.0.0", ...panelOpts });
  panels.push(panel);
  const name = `runner-it-${process.pid}-${containers.length}`;
  const vars = {
    SESSION_ID: "sess-1",
    SESSION_SECRET: "secret-1",
    PANEL_URL: `http://host.docker.internal:${panel.port}`,
    REPO_FULL_NAME: "octo/demo",
    REPO_URL: "file:///repos/demo.git",
    BASE_BRANCH: "main",
    DEFAULT_BRANCH: "main",
    WORK_BRANCH: "claude/test-a1b2",
    GIT_AUTHOR_NAME: "Test User",
    GIT_AUTHOR_EMAIL: "test@users.noreply.github.com",
    CLAUDE_BIN: "/opt/runner/test/stub-claude.sh",
    // The bind-mounted bare repos are owned by another uid (see make-bare-repo.mjs).
    GIT_CONFIG_SYSTEM: "/repos/gitconfig",
    ...env,
  };
  const envArgs = Object.entries(vars).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  docker("run", "-d", "--name", name, "--add-host", "host.docker.internal:host-gateway", "-v", `${reposDir}:/repos:ro`, ...envArgs, IMAGE);
  containers.push(name);
  return { name, panel };
}

const bootSteps = (panel) => panel.events.filter((e) => e.type === "boot_step").map((e) => `${e.data.step}:${e.data.status}`);

// Async on purpose: the fake panel lives in this process and must keep answering.
async function containerExitCode(name, timeoutMs = 60_000) {
  const { stdout } = await promisify(execFile)("docker", ["wait", name], { encoding: "utf8", timeout: timeoutMs });
  return Number(stdout.trim());
}

before(() => {
  if (!enabled) return;
  execFileSync("docker", ["build", "-q", "-t", IMAGE, RUNNER_DIR], { stdio: ["ignore", "ignore", "inherit"], timeout: 900_000 });
  reposDir = makeBareRepos();
});

after(async () => {
  for (const name of containers) spawnSync("docker", ["rm", "-f", name]);
  await Promise.all(panels.map((p) => p.close()));
});

let happy;
async function happySession() {
  happy ??= startSession(
    { STARTING_TASK_B64: Buffer.from(STARTING_TASK, "utf8").toString("base64") },
    { secrets: { API_KEY: "x\ny", TOKEN: "tok-s3cret-value" } },
  );
  const session = await happy;
  await waitFor(() => session.panel.events.some((e) => e.type === "remote_control_url"), 60_000, "remote_control_url");
  return session;
}

test("unit tests pass inside the image (Linux)", { skip: !enabled }, () => {
  const out = docker("run", "--rm", "--entrypoint", "npm", IMAGE, "--prefix", "/opt/runner", "test");
  assert.match(out, /ℹ fail 0/);
});

test("boots and reports url", { skip: !enabled }, async () => {
  const { panel } = await happySession();
  const steps = bootSteps(panel);
  const order = ["clone:done", "branch:done", "config:done", "secrets:done", "launch:started"];
  const positions = order.map((s) => steps.indexOf(s));
  assert.ok(positions.every((p) => p >= 0), `missing steps in ${steps}`);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.ok(!steps.some((s) => s.endsWith(":failed")), `${steps}`);
  const urlIndex = panel.events.findIndex((e) => e.type === "remote_control_url");
  const launchIndex = panel.events.findIndex((e) => e.type === "boot_step" && e.data.step === "launch");
  assert.ok(urlIndex > launchIndex);
  assert.equal(panel.events[urlIndex].data.url, "https://claude.ai/code/session_stub123");
  assert.equal(panel.events.filter((e) => e.type === "remote_control_url").length, 1);
});

test("creates work branch from base", { skip: !enabled }, async () => {
  const { name } = await happySession();
  assert.equal(docker("exec", "-u", "claude", name, "git", "-C", "/workspace/repo", "rev-parse", "--abbrev-ref", "HEAD").trim(), "claude/test-a1b2");
  assert.equal(
    docker("exec", "-u", "claude", name, "git", "-C", "/workspace/repo", "rev-parse", "HEAD").trim(),
    docker("exec", "-u", "claude", name, "git", "-C", "/workspace/repo", "rev-parse", "origin/main").trim(),
  );
  assert.equal(docker("exec", "-u", "claude", name, "git", "-C", "/workspace/repo", "config", "user.email").trim(), "test@users.noreply.github.com");
});

test("push mode works on the base branch", { skip: !enabled }, async () => {
  const { name, panel } = await startSession({ DELIVERY_MODE: "push", WORK_BRANCH: "main" });
  await waitFor(() => bootSteps(panel).includes("branch:done"), 60_000, "branch step");
  const git = (...args) => docker("exec", "-u", "claude", name, "git", "-C", "/workspace/repo", ...args).trim();
  assert.equal(git("rev-parse", "--abbrev-ref", "HEAD"), "main");
  assert.equal(git("rev-parse", "--abbrev-ref", "main@{upstream}"), "origin/main");
  assert.equal(git("branch", "--list", "claude/*"), "");
});

test("push mode with a different work branch fails clearly", { skip: !enabled }, async () => {
  const { name, panel } = await startSession({ DELIVERY_MODE: "push" });
  assert.equal(await containerExitCode(name), 1);
  const failed = panel.events.find((e) => e.type === "boot_step" && e.data.status === "failed");
  assert.equal(failed?.data.step, "branch");
  assert.match(failed.data.error, /equal BASE_BRANCH/);
});

test("starting task reaches claude byte-for-byte", { skip: !enabled }, async () => {
  const { name } = await happySession();
  const argv = execFileSync("docker", ["exec", "-u", "claude", name, "cat", "/tmp/stub-argv"]).toString("utf8").split("\0").slice(0, -1);
  assert.ok(argv.includes(STARTING_TASK), `argv was ${JSON.stringify(argv)}`);
  assert.ok(argv.includes("--remote-control"));
  assert.deepEqual(argv.slice(argv.indexOf("--permission-mode"), argv.indexOf("--permission-mode") + 2), ["--permission-mode", "auto"]);
});

test("secrets land in .env.local and not in events", { skip: !enabled }, async () => {
  const { name, panel } = await happySession();
  const env = docker("exec", "-u", "claude", name, "cat", "/workspace/repo/.env.local");
  assert.ok(env.includes('API_KEY="x\\ny"'), env);
  assert.equal(docker("exec", "-u", "claude", name, "git", "-C", "/workspace/repo", "status", "--porcelain").trim(), "");
  const events = JSON.stringify(panel.events);
  assert.ok(!events.includes("tok-s3cret-value"));
  assert.ok(!events.includes("x\\ny"));
  assert.ok(!docker("logs", name).includes("tok-s3cret-value"));
});

test("missing base branch fails clearly", { skip: !enabled }, async () => {
  const { name, panel } = await startSession({ BASE_BRANCH: "nope" });
  assert.equal(await containerExitCode(name), 1);
  const failed = panel.events.find((e) => e.type === "boot_step" && e.data.status === "failed");
  assert.equal(failed?.data.step, "clone");
  assert.match(failed.data.error, /nope/);
});

test("missing required env fails clearly", { skip: !enabled }, async () => {
  const { name, panel } = await startSession({ BASE_BRANCH: "" });
  assert.equal(await containerExitCode(name), 1);
  const failed = panel.events.find((e) => e.type === "boot_step" && e.data.status === "failed");
  assert.equal(failed?.data.step, "clone");
  assert.match(failed.data.error, /BASE_BRANCH/);
});

test("gh is authenticated through the panel", { skip: !enabled }, async () => {
  const { name } = await happySession();
  // async: gh calls back into the fake panel in this process
  const { stdout } = await promisify(execFile)("docker", ["exec", "-u", "claude", name, "gh", "auth", "token"], { encoding: "utf8" });
  assert.equal(stdout.trim(), "ghs_test_token");
});

test("empty repo fails clearly", { skip: !enabled }, async () => {
  const { name, panel } = await startSession({ REPO_URL: "file:///repos/empty.git" });
  assert.equal(await containerExitCode(name), 1);
  const failed = panel.events.find((e) => e.type === "boot_step" && e.data.status === "failed");
  assert.equal(failed?.data.step, "clone");
  assert.ok(failed.data.error.length > 0);
});

test("crash loop goes fatal", { skip: !enabled }, async () => {
  const { panel } = await startSession({ STUB_EXIT: "1", SUPERVISE_BACKOFF_SCALE: "0.01" });
  const exits = () => panel.events.filter((e) => e.type === "claude_exited");
  await waitFor(() => exits().length >= 5, 90_000, "5 claude_exited events");
  await sleep(5_000);
  const all = exits();
  assert.equal(all.length, 5);
  assert.deepEqual(
    all.map((e) => [e.data.code, e.data.restarting, e.data.fatal]),
    [[1, true, false], [1, true, false], [1, true, false], [1, true, false], [1, false, true]],
  );
});

test("restarted container resumes without re-cloning or re-sending the task", { skip: !enabled }, async () => {
  const { name, panel } = await startSession({ STARTING_TASK_B64: Buffer.from("first task", "utf8").toString("base64") });
  await waitFor(() => panel.events.some((e) => e.type === "remote_control_url"), 60_000, "first url");
  const before = panel.events.length;
  docker("restart", "-t", "1", name);
  await waitFor(() => panel.events.slice(before).some((e) => e.type === "remote_control_url"), 60_000, "url after restart");
  const after = panel.events.slice(before).filter((e) => e.type === "boot_step").map((e) => e.data.step);
  assert.ok(!after.includes("clone") && !after.includes("branch"), `${after}`);
  const argv = execFileSync("docker", ["exec", "-u", "claude", name, "cat", "/tmp/stub-argv"]).toString("utf8").split("\0");
  assert.ok(argv.includes("--continue"));
  assert.ok(!argv.includes("first task"));
});

// The same script the panel runs as user 1000 via execInRepo (panel/src/auto-resume/session-keys.ts).
const RELAUNCH_SCRIPT =
  'printf %s "$1" | base64 -d > "$HOME/.runner/resume-message" && touch "$HOME/.runner/panel-relaunch" && { tmux kill-session -t claude 2>/dev/null || true; }';
const requestRelaunch = (name, message) =>
  docker("exec", "-u", "claude", name, "sh", "-c", RELAUNCH_SCRIPT, "sh", Buffer.from(message, "utf8").toString("base64"));
const readArgv = (name) =>
  execFileSync("docker", ["exec", "-u", "claude", name, "cat", "/tmp/stub-argv"]).toString("utf8").split("\0").slice(0, -1);
const hasTmuxSession = (name) => spawnSync("docker", ["exec", "-u", "claude", name, "tmux", "has-session", "-t", "claude"]).status === 0;

test("a requested relaunch does not count toward the fatal limit", { skip: !enabled }, async () => {
  const { name, panel } = await startSession();
  const exits = () => panel.events.filter((e) => e.type === "claude_exited");
  await waitFor(() => panel.events.some((e) => e.type === "remote_control_url"), 60_000, "first url");
  for (let i = 1; i <= 5; i++) {
    await waitFor(() => hasTmuxSession(name), 30_000, `session before relaunch ${i}`);
    requestRelaunch(name, `resume ${i}`);
    await waitFor(() => exits().length >= i, 30_000, `claude_exited ${i}`);
  }
  await waitFor(() => hasTmuxSession(name), 30_000, "session after 5 relaunches");
  assert.deepEqual(
    exits().map((e) => [e.data.restarting, e.data.fatal, e.data.requested]),
    Array(5).fill([true, false, true]),
  );
  assert.deepEqual(readArgv(name).slice(0, 1), ["--continue"]);
});

test("resume passes the message once", { skip: !enabled }, async () => {
  const { name, panel } = await startSession();
  await waitFor(() => panel.events.some((e) => e.type === "remote_control_url"), 60_000, "first url");
  await waitFor(() => hasTmuxSession(name), 30_000, "session");
  requestRelaunch(name, "keep going");
  await waitFor(() => panel.events.some((e) => e.type === "claude_exited"), 30_000, "claude_exited");
  await waitFor(() => hasTmuxSession(name) && readArgv(name).includes("keep going"), 30_000, "relaunch with message");
  assert.ok(readArgv(name).includes("--continue"));
  // A later plain relaunch (marker only, no new message) must not replay it.
  docker("exec", "-u", "claude", name, "sh", "-c", 'touch "$HOME/.runner/panel-relaunch"; tmux kill-session -t claude');
  await waitFor(() => panel.events.filter((e) => e.type === "claude_exited").length >= 2, 30_000, "second claude_exited");
  await waitFor(() => hasTmuxSession(name) && !readArgv(name).includes("keep going"), 30_000, "relaunch without message");
  assert.ok(readArgv(name).includes("--continue"));
});

test("resume message with quotes and newlines arrives intact", { skip: !enabled }, async () => {
  const message = 'Continue "now" $HOME `id` \n\nline2\n\n \'q\' 🚀 && rm -rf /\n';
  const { name, panel } = await startSession();
  await waitFor(() => panel.events.some((e) => e.type === "remote_control_url"), 60_000, "first url");
  await waitFor(() => hasTmuxSession(name), 30_000, "session");
  requestRelaunch(name, message);
  await waitFor(() => hasTmuxSession(name) && readArgv(name).includes(message), 30_000, "relaunch with exact message");
});
