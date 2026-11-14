#!/usr/bin/env node
// Usage: report-event <type> [json-data]
//        report-event hook        (reads Claude Code hook JSON on stdin)
// Always exits 0: a reporting failure must never break boot or Claude's hooks.
import { postEvent } from "../lib/panel-client.mjs";

const SESSION_START_SOURCES = new Set(["startup", "resume", "clear", "compact"]);

async function readStdin() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

async function main() {
  const [type, rawData] = process.argv.slice(2);
  if (!type) {
    console.error("usage: report-event <type> [json-data]");
    return;
  }

  let data = {};
  if (type === "hook") {
    let payload = {};
    try {
      payload = JSON.parse(await readStdin());
    } catch {
      // malformed hook input: still report that a hook fired
    }
    // Forward only the event name and its human message — never the full
    // payload (tool inputs, transcript paths may carry secrets).
    data = { event: String(payload.hook_event_name ?? "unknown") };
    if (typeof payload.message === "string") data.message = payload.message;
    if (data.event === "SessionStart" && SESSION_START_SOURCES.has(payload.source)) data.source = payload.source;
  } else if (rawData) {
    try {
      data = JSON.parse(rawData);
    } catch {
      console.error("report-event: data is not valid JSON");
      return;
    }
  }

  // Claude waits on its hooks: keep a down panel from stalling every prompt.
  const ok = await postEvent(type, data, type === "hook" ? { retries: 2, timeoutMs: 1_000 } : {});
  if (!ok) console.error(`report-event: could not deliver ${type} event`);
}

await main();
