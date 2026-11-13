#!/usr/bin/env node
// Usage: assemble-home [--config DIR] [--overlay DIR] [--home DIR] [--repo DIR] [--auth DIR]
// ${WORK_BRANCH} / ${DEFAULT_BRANCH} in the session overlay come from the environment.
import { parseArgs } from "node:util";
import { homedir } from "node:os";
import { assembleHome } from "../lib/assemble-home.mjs";

const { values } = parseArgs({
  options: {
    config: { type: "string", default: "/opt/session-config" },
    overlay: { type: "string", default: "/opt/runner/overlay" },
    home: { type: "string", default: homedir() },
    repo: { type: "string", default: "/workspace/repo" },
    auth: { type: "string", default: "/claude-auth" },
  },
});

await assembleHome({ configDir: values.config, overlayDir: values.overlay, homeDir: values.home, repoDir: values.repo, authDir: values.auth });
console.log(`assembled Claude home in ${values.home}`);
