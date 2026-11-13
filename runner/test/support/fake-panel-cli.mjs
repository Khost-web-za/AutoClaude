#!/usr/bin/env node
// Runs the fake panel as a standalone server (used by scripts/verify-sysbox.sh).
// Usage: fake-panel-cli.mjs [port]   — session sess-1 / secret secret-1, no secrets.
import { startFakePanel } from "./fake-panel.mjs";

const port = Number(process.argv[2] ?? 3000);
const panel = await startFakePanel({ host: "0.0.0.0", port });
console.log(`fake panel listening on :${panel.port}`);
setInterval(() => {}, 1 << 30);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => panel.close().then(() => process.exit(0)));
