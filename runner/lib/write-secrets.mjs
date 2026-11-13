// Writes the repository's secrets (from the panel) to `.env.local` in the
// workspace, making sure git never tracks it (spec call #15).
import { execFile } from "node:child_process";
import { appendFile, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const VALID_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ESCAPES = { "\\": "\\\\", '"': '\\"', "\n": "\\n", "\r": "\\r", $: "\\$" };

/** Serializes secrets as dotenv lines: keys sorted, every value double-quoted and escaped. */
export function formatDotenv(secrets) {
  const keys = Object.keys(secrets).sort();
  for (const key of keys) {
    if (!VALID_KEY.test(key)) throw new Error(`invalid secret name ${JSON.stringify(key)}`);
  }
  return keys.map((key) => `${key}="${String(secrets[key]).replace(/[\\"\n\r$]/g, (c) => ESCAPES[c])}"\n`).join("");
}

async function isIgnored(repoDir, file) {
  try {
    await execFileAsync("git", ["-C", repoDir, "check-ignore", "-q", file]);
    return true;
  } catch {
    return false;
  }
}

export async function writeSecrets(repoDir, secrets) {
  const file = join(repoDir, ".env.local");
  await writeFile(file, formatDotenv(secrets), { mode: 0o600 });
  await chmod(file, 0o600); // writeFile's mode only applies on create

  if (await isIgnored(repoDir, ".env.local")) return { file, excluded: false };

  const infoDir = join(repoDir, ".git", "info");
  const excludePath = join(infoDir, "exclude");
  await mkdir(infoDir, { recursive: true });
  const current = existsSync(excludePath) ? await readFile(excludePath, "utf8") : "";
  const prefix = current && !current.endsWith("\n") ? "\n" : "";
  await appendFile(excludePath, `${prefix}.env.local\n`);
  return { file, excluded: true };
}
