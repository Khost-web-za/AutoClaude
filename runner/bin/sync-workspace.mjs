#!/usr/bin/env node
// SessionStart hook: syncs the workspace with its remote, reports the outcome to
// the panel and hands Claude the result as additionalContext.
// Always exits 0: a sync problem must never block the session.
import { postEvent } from "../lib/panel-client.mjs";
import { syncWorkspace } from "../lib/sync-workspace.mjs";

async function readStdin() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

async function main() {
  let payload = {};
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    // malformed hook input: treat as an unknown source and skip
  }
  const source = String(payload.source ?? "unknown");
  const repoDir = typeof payload.cwd === "string" && payload.cwd ? payload.cwd : process.cwd();
  const mode = process.env.DELIVERY_MODE === "push" ? "push" : "pull_request";

  const { status, summary, context } = await syncWorkspace({ repoDir, source, mode });
  await postEvent("workspace_sync", { status, summary, source }, { retries: 2, timeoutMs: 1_000 });
  if (status !== "skipped") {
    process.stdout.write(
      JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context } }),
    );
  }
}

try {
  await main();
} catch (err) {
  console.error(`sync-workspace: ${err.message}`);
}
