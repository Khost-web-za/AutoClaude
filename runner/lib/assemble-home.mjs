// Builds the session's Claude home from the user's config folder plus the
// session overlay (spec calls #4, #7, #11, #16).
import { cp, mkdir, readFile, writeFile, symlink, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const WINDOWS_PATH = /\b[A-Za-z]:\\/;
const DROPPED_USER_KEYS = ["permissions", "apiKeyHelper"];
// Top-level config files handled separately below; never copied verbatim.
const NOT_COPIED = ["settings.json", "CLAUDE.md", ".credentials.json", "README.md"];

/** `~/.claude.json` keys that pre-answer first-run prompts. */
export const PRESEEDED_STATE = {
  hasCompletedOnboarding: true,
  theme: "dark",
  bypassPermissionsModeAccepted: true,
};

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const containsWindowsPath = (v) =>
  typeof v === "string" ? WINDOWS_PATH.test(v) : Array.isArray(v) || isObject(v) ? Object.values(v).some(containsWindowsPath) : false;

/**
 * Drops anything carrying a Windows path: array entries that contain one, and
 * object keys whose (non-array) value contains one. `hooks` maps are walked
 * so one Windows-only hook doesn't take every hook with it.
 */
function stripWindowsPaths(value) {
  if (Array.isArray(value)) return value.filter((v) => !containsWindowsPath(v)).map(stripWindowsPaths);
  if (!isObject(value)) return value;
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    if (Array.isArray(v) || key === "hooks" || !containsWindowsPath(v)) out[key] = stripWindowsPaths(v);
  }
  return out;
}

function deepMerge(base, overlay) {
  const out = { ...base };
  for (const [key, v] of Object.entries(overlay)) out[key] = isObject(v) && isObject(out[key]) ? deepMerge(out[key], v) : v;
  return out;
}

/** User settings minus permissions / apiKeyHelper / Windows paths, with the session overlay on top. */
export function mergeSettings(userSettings, sessionSettings) {
  const user = stripWindowsPaths(userSettings);
  for (const key of DROPPED_USER_KEYS) delete user[key];

  const { permissions, hooks: sessionHooks = {}, ...rest } = sessionSettings;
  const merged = deepMerge(user, rest);
  if (permissions) merged.permissions = permissions;

  const hooks = { ...(user.hooks ?? {}) };
  for (const [event, matchers] of Object.entries(sessionHooks)) hooks[event] = [...(hooks[event] ?? []), ...matchers];
  merged.hooks = hooks;
  return merged;
}

const substitute = (text, vars) => text.replace(/\$\{([A-Z_]+)\}/g, (m, name) => vars[name] ?? m);

async function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(await readFile(path, "utf8"));
}

async function readText(path) {
  return existsSync(path) ? readFile(path, "utf8") : "";
}

/** Links `<claudeDir>/.credentials.json` to the shared auth volume so a token refresh writes back to it. */
export async function linkSharedCredentials(claudeDir, authDir) {
  const credLink = join(claudeDir, ".credentials.json");
  await rm(credLink, { force: true });
  try {
    await symlink(join(authDir, ".credentials.json"), credLink);
  } catch (err) {
    // Windows dev machines can't create symlinks unprivileged; the image is Linux.
    if (!(process.platform === "win32" && err.code === "EPERM")) throw err;
  }
}

export async function assembleHome({ configDir, overlayDir, homeDir, repoDir, authDir, vars = process.env }) {
  const claudeDir = join(homeDir, ".claude");
  await mkdir(claudeDir, { recursive: true });

  // 1. user config folder (skills, agents, commands, plugins, …)
  if (existsSync(configDir)) {
    const root = resolve(configDir);
    await cp(configDir, claudeDir, {
      recursive: true,
      force: true,
      filter: (src) => !(dirname(resolve(src)) === root && NOT_COPIED.some((name) => resolve(src) === join(root, name))),
    });
  }

  // 2. settings.json
  const userSettings = await readJson(join(configDir, "settings.json"), {});
  const sessionSettings = await readJson(join(overlayDir, "settings.session.json"), {});
  await writeFile(join(claudeDir, "settings.json"), JSON.stringify(mergeSettings(userSettings, sessionSettings), null, 2) + "\n");

  // 3. CLAUDE.md = user + session overlay (delivery rules depend on DELIVERY_MODE)
  const userMd = await readText(join(configDir, "CLAUDE.md"));
  const mode = vars.DELIVERY_MODE === "push" ? "push" : "pull_request";
  const deliveryRules = substitute((await readText(join(overlayDir, `delivery-${mode}.md`))).trimEnd(), vars);
  const sessionMd = substitute(await readText(join(overlayDir, "CLAUDE.session.md")), { ...vars, DELIVERY_RULES: deliveryRules });
  await writeFile(join(claudeDir, "CLAUDE.md"), userMd ? `${userMd}\n\n${sessionMd}` : sessionMd);

  // 4. shared credentials (spike: "Credential sharing")
  await linkSharedCredentials(claudeDir, authDir);

  // 5. ~/.claude.json: first-run answers + trust for the repo, keeping existing state on restart
  const statePath = join(homeDir, ".claude.json");
  const state = await readJson(statePath, {});
  const projects = { ...(state.projects ?? {}) };
  projects[repoDir] = { ...(projects[repoDir] ?? {}), hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true };
  await writeFile(statePath, JSON.stringify({ ...state, ...PRESEEDED_STATE, projects }, null, 2) + "\n");
}
