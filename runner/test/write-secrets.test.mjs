import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatDotenv, writeSecrets } from "../lib/write-secrets.mjs";
import { startFakePanel } from "./support/fake-panel.mjs";
import { runCli } from "./support/run-cli.mjs";

// Test-only parser for the subset formatDotenv emits: KEY="escaped value" per line.
function parseDotenv(text) {
  const out = {};
  for (const line of text.split("\n")) {
    if (!line) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)="((?:[^"\\]|\\.)*)"$/);
    assert.ok(m, `unparseable line: ${line}`);
    out[m[1]] = m[2].replace(/\\(.)/g, (_, c) => ({ n: "\n", r: "\r" })[c] ?? c);
  }
  return out;
}

const TRICKY = {
  MULTILINE: "line1\nline2",
  QUOTES: 'say "hi"',
  HASH: "abc#not-a-comment",
  EQUALS: "a=b=c",
  DOLLAR: "$HOME and ${PATH}",
  BACKSLASH: "C:\\path\\to",
  EMOJI: "🚀 launch",
  CRLF: "a\r\nb",
};

test("formatDotenv round-trips tricky values", () => {
  const text = formatDotenv(TRICKY);
  assert.deepEqual(parseDotenv(text), TRICKY);
  assert.equal(text.split("\n").filter(Boolean).length, Object.keys(TRICKY).length);
});

test("formatDotenv sorts keys", () => {
  assert.equal(formatDotenv({ B: "2", A: "1" }), 'A="1"\nB="2"\n');
});

test("formatDotenv rejects invalid keys without echoing values", () => {
  assert.throws(() => formatDotenv({ "BAD KEY": "s3cr3t" }), (err) => !String(err.message).includes("s3cr3t"));
});

function gitRepo() {
  const dir = mkdtempSync(join(tmpdir(), "secrets-"));
  execFileSync("git", ["init", "-q", dir]);
  return dir;
}

test("adds exclude when not ignored", async () => {
  const repo = gitRepo();
  const { file, excluded } = await writeSecrets(repo, { A: "1" });
  assert.equal(file, join(repo, ".env.local"));
  assert.equal(excluded, true);
  assert.match(readFileSync(join(repo, ".git", "info", "exclude"), "utf8"), /^\.env\.local$/m);
  assert.equal(execFileSync("git", ["-C", repo, "status", "--porcelain"], { encoding: "utf8" }), "");
});

test("does not touch exclude when already gitignored", async () => {
  const repo = gitRepo();
  writeFileSync(join(repo, ".gitignore"), ".env*\n");
  const excludePath = join(repo, ".git", "info", "exclude");
  const before = existsSync(excludePath) ? readFileSync(excludePath, "utf8") : null;
  const { excluded } = await writeSecrets(repo, { A: "1" });
  assert.equal(excluded, false);
  assert.equal(existsSync(excludePath) ? readFileSync(excludePath, "utf8") : null, before);
});

test("rewriting does not duplicate the exclude line", async () => {
  const repo = gitRepo();
  await writeSecrets(repo, { A: "1" });
  await writeSecrets(repo, { A: "2" });
  const lines = readFileSync(join(repo, ".git", "info", "exclude"), "utf8").split("\n").filter((l) => l === ".env.local");
  assert.equal(lines.length, 1);
  assert.deepEqual(parseDotenv(readFileSync(join(repo, ".env.local"), "utf8")), { A: "2" });
});

test("file mode is 0600", { skip: process.platform === "win32" && "no POSIX modes on Windows" }, async () => {
  const repo = gitRepo();
  await writeSecrets(repo, { A: "1" });
  assert.equal(statSync(join(repo, ".env.local")).mode & 0o777, 0o600);
});

test("CLI output never contains a secret value", async () => {
  const repo = gitRepo();
  const panel = await startFakePanel({ secrets: { API_KEY: "x\ny", TOKEN: "sup3r-s3cret" } });
  try {
    const res = await runCli("write-secrets.mjs", ["--repo", repo], {
      env: { PANEL_URL: panel.url, SESSION_ID: "sess-1", SESSION_SECRET: "secret-1" },
    });
    assert.equal(res.code, 0, res.stderr);
    const output = res.stdout + res.stderr;
    assert.ok(!output.includes("sup3r-s3cret"));
    assert.ok(!output.includes("x\ny"));
    assert.match(res.stdout, /\b2\b/);
    assert.deepEqual(parseDotenv(readFileSync(join(repo, ".env.local"), "utf8")), { API_KEY: "x\ny", TOKEN: "sup3r-s3cret" });
  } finally {
    await panel.close();
  }
});

test("CLI writes nothing when there are no secrets", async () => {
  const repo = gitRepo();
  const panel = await startFakePanel({ secrets: {} });
  try {
    const res = await runCli("write-secrets.mjs", ["--repo", repo], {
      env: { PANEL_URL: panel.url, SESSION_ID: "sess-1", SESSION_SECRET: "secret-1" },
    });
    assert.equal(res.code, 0, res.stderr);
    assert.equal(existsSync(join(repo, ".env.local")), false);
  } finally {
    await panel.close();
  }
});

test("CLI exits 1 when the panel is down", async () => {
  const repo = gitRepo();
  const panel = await startFakePanel({ down: true });
  try {
    const res = await runCli("write-secrets.mjs", ["--repo", repo], {
      env: { PANEL_URL: panel.url, SESSION_ID: "sess-1", SESSION_SECRET: "secret-1" },
    });
    assert.equal(res.code, 1);
  } finally {
    await panel.close();
  }
});
