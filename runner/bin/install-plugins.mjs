#!/usr/bin/env node
// Usage: install-plugins [--settings FILE]
// Adds the marketplaces and installs the plugins a settings.json declares.
// A failed plugin is reported but doesn't fail the boot: the session is still
// usable without it.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { pluginInstallPlan } from "../lib/plugin-plan.mjs";

const { values } = parseArgs({ options: { settings: { type: "string", default: "/opt/session-config/settings.json" } } });

if (!existsSync(values.settings)) {
  console.log("install-plugins: no settings.json, nothing to install");
  process.exit(0);
}

const { marketplaces, plugins } = pluginInstallPlan(JSON.parse(readFileSync(values.settings, "utf8")));
const claude = (args) => execFileSync("claude", args, { stdio: ["ignore", "inherit", "inherit"], timeout: 120_000 });

let failed = 0;
for (const source of marketplaces) {
  try {
    claude(["plugin", "marketplace", "add", source]);
  } catch {
    failed++;
    console.error(`install-plugins: could not add marketplace ${source}`);
  }
}
for (const id of plugins) {
  try {
    claude(["plugin", "install", id]);
  } catch {
    failed++;
    console.error(`install-plugins: could not install ${id}`);
  }
}
console.log(`install-plugins: ${marketplaces.length} marketplace(s), ${plugins.length} plugin(s), ${failed} failure(s)`);
