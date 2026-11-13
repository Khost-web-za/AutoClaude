#!/usr/bin/env node
// git credential helper: `credential.helper "!node /opt/runner/bin/git-credential-panel.mjs"`.
// On `get` for github.com, asks the panel for a short-lived installation token.
// `store` / `erase` are no-ops. On failure: exit 1, nothing on stdout, so git
// fails cleanly instead of hanging on a prompt.
import { panelRequest } from "../lib/panel-client.mjs";

function parseCredentialInput(text) {
  const fields = {};
  for (const line of text.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) fields[line.slice(0, eq)] = line.slice(eq + 1).trim();
  }
  return fields;
}

async function readStdin() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

async function main() {
  const op = process.argv[2];
  const input = parseCredentialInput(await readStdin());
  if (op !== "get" || input.host !== "github.com") return 0;

  try {
    const res = await panelRequest("POST", "/api/runner/git-credential", { repo: process.env.REPO_FULL_NAME }, { retries: 2, timeoutMs: 1_000 });
    if (!res.ok) {
      await res.body?.cancel();
      console.error(`git-credential-panel: panel responded ${res.status}`);
      return 1;
    }
    const { username, password } = await res.json();
    if (!username || !password) {
      console.error("git-credential-panel: panel returned no credential");
      return 1;
    }
    process.stdout.write(`username=${username}\npassword=${password}\n`);
    return 0;
  } catch (err) {
    console.error(`git-credential-panel: ${err.message}`);
    return 1;
  }
}

process.exitCode = await main();
