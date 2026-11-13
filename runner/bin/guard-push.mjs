#!/usr/bin/env node
// PreToolUse hook (matcher: Bash). Prints an `ask` decision for pushes that
// need the user's confirmation; prints nothing (allow) otherwise.
import { execFileSync } from "node:child_process";
import { classifyCommand } from "../lib/push-guard.mjs";

function currentBranch(cwd) {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

let input = "";
for await (const chunk of process.stdin) input += chunk;

let payload;
try {
  payload = JSON.parse(input);
} catch {
  process.exit(0);
}

const command = payload?.tool_input?.command;
if (payload?.tool_name === "Bash" && typeof command === "string") {
  const defaultBranch = process.env.DEFAULT_BRANCH || "main";
  const { decision, reason } = classifyCommand(command, defaultBranch, currentBranch(payload.cwd || process.cwd()));
  if (decision === "ask") {
    process.stdout.write(
      JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: reason } }),
    );
  }
}
