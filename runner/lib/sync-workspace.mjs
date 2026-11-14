// Brings the workspace up to date with its remote at session start.
// Never resets, never force-pushes: a failed rebase is left for Claude to resolve.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const SYNC_SOURCES = new Set(["startup", "resume", "clear"]);
const PULL_TIMEOUT_MS = 60_000;

const RESOLVE_HINT =
  "Resolve it (or ask the user if the intent of conflicting changes is unclear). Never reset or force-push.";
const AUTOSTASH_CONFLICT =
  "The workspace was synced with its remote, but re-applying your uncommitted edits left merge conflicts in the working tree. Your edits are also kept in the stash (stash@{0}). Resolve the conflicts, or ask the user (AskUserQuestion) if the intent is unclear. Never drop the stash, reset or force-push.";
const REBASE_IN_PROGRESS =
  "A rebase is in progress in the workspace. Finish it (resolve conflicts, `git rebase --continue`) before other work; ask the user if the intent of conflicting changes is unclear. Never reset or force-push.";

/** Masks URL credentials, the JS twin of the sed in entrypoint.sh. */
export function maskCredentials(text) {
  return text.replace(/:\/\/[^/@\s]+@/g, "://***@");
}

function git(repoDir, args, timeout = PULL_TIMEOUT_MS) {
  return new Promise((resolve) => {
    execFile("git", ["-C", repoDir, ...args], { timeout, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout).trim(), stderr: String(stderr).trim(), err });
    });
  });
}

function errorTail(result) {
  const text = result.stderr || result.stdout || result.err?.message || "git pull failed";
  return maskCredentials(text.split(/\r?\n/).filter(Boolean).slice(-5).join("\n"));
}

/** @returns {Promise<{status: 'ok'|'skipped'|'failed', summary: string, context: string}>} */
export async function syncWorkspace({ repoDir, source, mode }) {
  if (!SYNC_SOURCES.has(source)) {
    return { status: "skipped", summary: "nothing to sync for this session start", context: "" };
  }

  if (existsSync(join(repoDir, ".git", "rebase-merge")) || existsSync(join(repoDir, ".git", "rebase-apply"))) {
    return { status: "failed", summary: "rebase already in progress", context: REBASE_IN_PROGRESS };
  }

  if (mode === "pull_request") {
    const upstream = await git(repoDir, ["rev-parse", "--abbrev-ref", "@{u}"], 10_000);
    if (!upstream.ok) {
      return { status: "skipped", summary: "work branch not pushed yet", context: "" };
    }
  }

  const pull = await git(repoDir, ["pull", "--rebase", "--autostash"]);
  if (!pull.ok) {
    const tail = errorTail(pull);
    return {
      status: "failed",
      summary: tail.split("\n").at(-1).slice(0, 200),
      context: `Syncing the workspace with its remote failed:\n${tail}\n${RESOLVE_HINT}`,
    };
  }

  // `pull --autostash` exits 0 even when re-applying the stash conflicts.
  const unmerged = await git(repoDir, ["diff", "--name-only", "--diff-filter=U"], 10_000);
  if (unmerged.ok && unmerged.stdout) {
    return {
      status: "failed",
      summary: "uncommitted edits conflict with incoming changes",
      context: AUTOSTASH_CONFLICT,
    };
  }

  const [branch, sha] = await Promise.all([
    git(repoDir, ["rev-parse", "--abbrev-ref", "HEAD"], 10_000),
    git(repoDir, ["rev-parse", "--short", "HEAD"], 10_000),
  ]);
  const summary = `synced with origin/${branch.stdout} (${sha.stdout})`;
  return { status: "ok", summary, context: `Workspace synced with origin/${branch.stdout} (${sha.stdout}).` };
}
