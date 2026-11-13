import { test } from "node:test";
import assert from "node:assert/strict";
import { pluginInstallPlan } from "../lib/plugin-plan.mjs";

test("lists marketplace sources and enabled plugins", () => {
  const plan = pluginInstallPlan({
    extraKnownMarketplaces: {
      official: { source: { source: "github", repo: "anthropics/claude-plugins-official" } },
      company: { source: { source: "git", url: "https://git.example.com/plugins.git" } },
      local: { source: { source: "directory", path: "/opt/plugins" } },
    },
    enabledPlugins: { "superpowers@official": true, "old@official": false, "tool@company": true },
  });
  assert.deepEqual(plan.marketplaces, ["anthropics/claude-plugins-official", "https://git.example.com/plugins.git", "/opt/plugins"]);
  assert.deepEqual(plan.plugins, ["superpowers@official", "tool@company"]);
});

test("empty settings produce an empty plan", () => {
  assert.deepEqual(pluginInstallPlan({}), { marketplaces: [], plugins: [] });
});

test("skips marketplaces with Windows paths or unknown source types", () => {
  const plan = pluginInstallPlan({
    extraKnownMarketplaces: {
      win: { source: { source: "directory", path: "C:\\plugins" } },
      odd: { source: { source: "mystery" } },
    },
  });
  assert.deepEqual(plan.marketplaces, []);
});
