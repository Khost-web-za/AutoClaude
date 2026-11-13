import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyCommand } from "../lib/push-guard.mjs";
import { runCli } from "./support/run-cli.mjs";

const ASK = [
  "git push origin main",
  "git push origin HEAD:main",
  "git push origin HEAD:refs/heads/main",
  "git push -f",
  "git push --force-with-lease origin claude/x-1",
  "git push origin +claude/x-1",
  "git push -uf origin claude/x-1",
  "git push origin --delete claude/x-1",
  "git push origin :claude/x-1",
  "git push --all origin",
  "git commit -m x && git push origin main",
  "git status; git push origin main",
  "false || git push origin main",
  "git -C /workspace/repo push origin main",
  "git -c push.default=current push origin main",
  "GIT_TRACE=1 git push origin main",
  "gh pr merge 3",
  "gh repo delete",
];

const ALLOW = [
  "git push",
  "git push -u origin claude/fix-login-a1b2",
  "git push origin HEAD",
  "git push --tags",
  "git status",
  "rm -rf node_modules",
  "git reset --hard HEAD~1",
  "git branch -D old",
  'echo "git push origin main"',
  "echo 'git push -f' | cat",
  'git commit -m "do not git push origin main"',
  "gh pr create --fill",
];

for (const command of ASK) {
  test(`ask: ${command}`, () => {
    const result = classifyCommand(command, "main", "claude/x-1");
    assert.equal(result.decision, "ask");
    assert.ok(result.reason && result.reason.length > 0);
  });
}

for (const command of ALLOW) {
  test(`allow: ${command}`, () => {
    assert.equal(classifyCommand(command, "main", "claude/x-1").decision, "allow");
  });
}

test("ask: bare git push while on the default branch", () => {
  assert.equal(classifyCommand("git push", "main", "main").decision, "ask");
  assert.equal(classifyCommand("git push origin HEAD", "main", "main").decision, "ask");
});

function repoOnBranch(branch) {
  const dir = mkdtempSync(join(tmpdir(), "guard-"));
  execFileSync("git", ["init", "-q", "-b", branch, dir]);
  execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"]);
  return dir;
}

test("cli prints ask decision for a push to the default branch", async () => {
  const cwd = repoOnBranch("claude/x-1");
  const res = await runCli("guard-push.mjs", [], {
    env: { DEFAULT_BRANCH: "main" },
    stdin: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", cwd, tool_input: { command: "git push origin main" } }),
  });
  assert.equal(res.code, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(out.hookSpecificOutput.permissionDecision, "ask");
  assert.ok(out.hookSpecificOutput.permissionDecisionReason);
});

test("cli resolves the current branch for a bare push", async () => {
  const cwd = repoOnBranch("main");
  const res = await runCli("guard-push.mjs", [], {
    env: { DEFAULT_BRANCH: "main" },
    stdin: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", cwd, tool_input: { command: "git push" } }),
  });
  assert.equal(JSON.parse(res.stdout).hookSpecificOutput.permissionDecision, "ask");
});

test("cli prints nothing for allowed commands and other tools", async () => {
  const cwd = repoOnBranch("claude/x-1");
  for (const payload of [
    { tool_name: "Bash", cwd, tool_input: { command: "git push" } },
    { tool_name: "Edit", cwd, tool_input: { file_path: "/x" } },
  ]) {
    const res = await runCli("guard-push.mjs", [], { env: { DEFAULT_BRANCH: "main" }, stdin: JSON.stringify(payload) });
    assert.equal(res.code, 0);
    assert.equal(res.stdout, "");
  }
});
