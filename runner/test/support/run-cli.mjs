// Runs a runner bin script with node, feeding stdin, collecting output.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export function binPath(name) {
  return fileURLToPath(new URL(`../../bin/${name}`, import.meta.url));
}

export function runCli(script, args = [], { env = {}, stdin = "", cwd } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [binPath(script), ...args], { cwd, env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr, ms: Date.now() - started }));
    child.stdin.end(stdin);
  });
}
