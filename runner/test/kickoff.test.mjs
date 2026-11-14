import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, lstatSync, readlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../kickoff.sh", import.meta.url));
const stub = fileURLToPath(new URL("./stub-claude.sh", import.meta.url));

function kickoff(stubExit) {
  const root = mkdtempSync(join(tmpdir(), "kickoff-"));
  const argvFile = join(root, "argv");
  const homeDir = join(root, "home");
  const authDir = join(root, "auth");
  const result = spawnSync("bash", [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_BIN: stub,
      STUB_ARGV_FILE: argvFile,
      STUB_EXIT: String(stubExit),
      KICKOFF_HOME: homeDir,
      RUNNER_DIR: fileURLToPath(new URL("..", import.meta.url)),
      CLAUDE_AUTH_DIR: authDir,
    },
  });
  return { result, argvFile, homeDir, authDir };
}

test("kickoff passes -p . --model haiku", () => {
  const { argvFile } = kickoff(0);
  assert.deepEqual(readFileSync(argvFile, "utf8").split("\0").slice(0, -1), ["-p", ".", "--model", "haiku"]);
});

test("kickoff exits with claude's code", () => {
  assert.equal(kickoff(0).result.status, 0);
  assert.equal(kickoff(3).result.status, 3);
});

test("kickoff links the shared credentials into its home", { skip: process.platform === "win32" }, () => {
  const { homeDir, authDir } = kickoff(0);
  const link = join(homeDir, ".claude", ".credentials.json");
  assert.ok(lstatSync(link).isSymbolicLink());
  assert.equal(readlinkSync(link), join(authDir, ".credentials.json"));
});
