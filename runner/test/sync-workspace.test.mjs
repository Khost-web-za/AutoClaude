import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncWorkspace } from "../lib/sync-workspace.mjs";
import { makeBareRepos } from "./support/make-bare-repo.mjs";
import { runCli } from "./support/run-cli.mjs";
import { startFakePanel } from "./support/fake-panel.mjs";

const IDENT = ["-c", "user.name=Test", "-c", "user.email=test@example.com"];
const git = (dir, ...args) => execFileSync("git", [...IDENT, "-C", dir, ...args], { stdio: "pipe" }).toString().trim();

// A bare "origin", a session clone, and a second clone that plays the pusher.
function setup() {
  const origin = join(makeBareRepos(), "demo.git");
  const base = mkdtempSync(join(tmpdir(), "sync-ws-"));
  const repo = join(base, "session");
  const other = join(base, "other");
  execFileSync("git", ["clone", "-q", origin, repo]);
  execFileSync("git", ["clone", "-q", origin, other]);
  return { repo, other };
}

// autocrlf on Windows checkouts: compare without CRs
const read = (dir, name) => readFileSync(join(dir, name), "utf8").replaceAll("\r", "");

function pushFile(dir, name, content, msg = `edit ${name}`) {
  writeFileSync(join(dir, name), content);
  git(dir, "add", name);
  git(dir, "commit", "-q", "-m", msg);
}

test("fast-forwards to the remote's new commit", async () => {
  const { repo, other } = setup();
  pushFile(other, "a.txt", "a\n");
  git(other, "push", "-q", "origin", "main");
  const r = await syncWorkspace({ repoDir: repo, source: "startup", mode: "push" });
  assert.equal(r.status, "ok");
  assert.match(r.context, /Workspace synced with origin\/main \([0-9a-f]{7,}\)\./);
  assert.equal(read(repo, "a.txt"), "a\n");
});

test("autostashes a dirty tree and keeps the edit", async () => {
  const { repo, other } = setup();
  pushFile(other, "a.txt", "a\n");
  git(other, "push", "-q", "origin", "main");
  writeFileSync(join(repo, "README.md"), "# dirty\n");
  const r = await syncWorkspace({ repoDir: repo, source: "resume", mode: "push" });
  assert.equal(r.status, "ok");
  assert.equal(read(repo, "README.md"), "# dirty\n");
  assert.ok(existsSync(join(repo, "a.txt")));
});

test("autostash conflict -> failed, edit kept in the stash", async () => {
  const { repo, other } = setup();
  pushFile(other, "README.md", "remote\n", "remote change");
  git(other, "push", "-q", "origin", "main");
  writeFileSync(join(repo, "README.md"), "dirty\n");
  const r = await syncWorkspace({ repoDir: repo, source: "startup", mode: "push" });
  assert.equal(r.status, "failed");
  assert.match(r.context, /stash@\{0\}/);
  assert.match(git(repo, "stash", "list"), /autostash/);
});

test("rebases a local commit onto a new remote commit", async () => {
  const { repo, other } = setup();
  pushFile(repo, "local.txt", "l\n");
  pushFile(other, "remote.txt", "r\n");
  git(other, "push", "-q", "origin", "main");
  const r = await syncWorkspace({ repoDir: repo, source: "clear", mode: "push" });
  assert.equal(r.status, "ok");
  assert.ok(existsSync(join(repo, "local.txt")) && existsSync(join(repo, "remote.txt")));
  assert.equal(git(repo, "log", "-1", "--format=%s"), "edit local.txt");
});

test("conflict -> failed, workspace left mid-rebase, no reset", async () => {
  const { repo, other } = setup();
  pushFile(repo, "README.md", "local\n", "local change");
  const localSha = git(repo, "rev-parse", "HEAD");
  pushFile(other, "README.md", "remote\n", "remote change");
  git(other, "push", "-q", "origin", "main");
  const r = await syncWorkspace({ repoDir: repo, source: "startup", mode: "push" });
  assert.equal(r.status, "failed");
  assert.ok(existsSync(join(repo, ".git", "rebase-merge")) || existsSync(join(repo, ".git", "rebase-apply")));
  assert.match(r.context, /never reset/i);
  git(repo, "cat-file", "-e", localSha); // local commit still reachable
  assert.match(git(repo, "reflog"), /local change/);
});

test("in-progress rebase -> failed without running git pull", async () => {
  const { repo } = setup();
  mkdirSync(join(repo, ".git", "rebase-merge"));
  const r = await syncWorkspace({ repoDir: repo, source: "startup", mode: "push" });
  assert.equal(r.status, "failed");
  assert.match(r.context, /A rebase is in progress in the workspace/);
});

test("compact -> skipped", async () => {
  const r = await syncWorkspace({ repoDir: "/nonexistent", source: "compact", mode: "push" });
  assert.equal(r.status, "skipped");
});

test("pull_request mode without upstream -> skipped", async () => {
  const { repo } = setup();
  git(repo, "checkout", "-q", "-b", "claude/x-1");
  const r = await syncWorkspace({ repoDir: repo, source: "startup", mode: "pull_request" });
  assert.equal(r.status, "skipped");
  assert.match(r.summary, /not pushed yet/);
});

test("bin prints additionalContext JSON and exits 0 even when the panel is down", async () => {
  const { repo, other } = setup();
  pushFile(other, "a.txt", "a\n");
  git(other, "push", "-q", "origin", "main");
  const res = await runCli("sync-workspace.mjs", [], {
    env: { PANEL_URL: "http://127.0.0.1:1", SESSION_ID: "sess-1", SESSION_SECRET: "secret-1", DELIVERY_MODE: "push" },
    stdin: JSON.stringify({ source: "startup", cwd: repo }),
  });
  assert.equal(res.code, 0);
  const out = JSON.parse(res.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(out.hookSpecificOutput.additionalContext, /Workspace synced/);
});

test("bin posts workspace_sync and prints nothing when skipped", async () => {
  const panel = await startFakePanel();
  try {
    const res = await runCli("sync-workspace.mjs", [], {
      env: { PANEL_URL: panel.url, SESSION_ID: "sess-1", SESSION_SECRET: "secret-1" },
      stdin: JSON.stringify({ source: "compact", cwd: "/nonexistent" }),
    });
    assert.equal(res.code, 0);
    assert.equal(res.stdout, "");
    assert.deepEqual(panel.events[0].data.status, "skipped");
    assert.equal(panel.events[0].type, "workspace_sync");
    assert.equal(panel.events[0].data.source, "compact");
  } finally {
    await panel.close();
  }
});
