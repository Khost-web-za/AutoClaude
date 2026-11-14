#!/usr/bin/env node
// Usage: kickoff-home --home DIR [--auth DIR]
// Minimal Claude home for a kick-off: shared credentials linked as in a session, first-run prompts pre-answered.
import { parseArgs } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { linkSharedCredentials, PRESEEDED_STATE } from "../lib/assemble-home.mjs";

const { values } = parseArgs({
  options: {
    home: { type: "string" },
    auth: { type: "string", default: "/claude-auth" },
  },
});
if (!values.home) throw new Error("--home is required");

const claudeDir = join(values.home, ".claude");
await mkdir(claudeDir, { recursive: true });
await linkSharedCredentials(claudeDir, values.auth);
await writeFile(join(values.home, ".claude.json"), JSON.stringify(PRESEEDED_STATE, null, 2) + "\n");
