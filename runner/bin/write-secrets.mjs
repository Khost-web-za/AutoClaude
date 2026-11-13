#!/usr/bin/env node
// Usage: write-secrets [--repo DIR]
// Fetches the repo's secrets from the panel and writes DIR/.env.local.
// Prints only the number of keys — never a value.
import { parseArgs } from "node:util";
import { panelRequest } from "../lib/panel-client.mjs";
import { writeSecrets } from "../lib/write-secrets.mjs";

const { values } = parseArgs({ options: { repo: { type: "string", default: "/workspace/repo" } } });

async function main() {
  let secrets;
  try {
    const res = await panelRequest("GET", "/api/runner/secrets");
    if (!res.ok) {
      await res.body?.cancel();
      console.error(`write-secrets: panel responded ${res.status}`);
      return 1;
    }
    ({ secrets = {} } = await res.json());
  } catch (err) {
    console.error(`write-secrets: ${err.message}`);
    return 1;
  }

  const count = Object.keys(secrets).length;
  if (count === 0) {
    console.log("write-secrets: no secrets for this repository");
    return 0;
  }
  try {
    const { excluded } = await writeSecrets(values.repo, secrets);
    console.log(`write-secrets: wrote ${count} secret(s) to .env.local${excluded ? " (added to .git/info/exclude)" : ""}`);
    return 0;
  } catch (err) {
    console.error(`write-secrets: ${err.message}`);
    return 1;
  }
}

process.exitCode = await main();
