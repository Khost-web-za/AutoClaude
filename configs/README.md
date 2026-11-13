# configs

Claude Code setups for session containers, organised as **profiles**. Each
profile is a folder here; a session picks which profiles to load.

## What a profile holds

A profile folder name must match `^[a-z0-9][a-z0-9-]{0,39}$` (lowercase letters,
digits, dashes). It mirrors the layout of `~/.claude`:

| Path | What |
|---|---|
| `CLAUDE.md` | instructions appended to the session's global `CLAUDE.md` |
| `skills/<name>/SKILL.md` | skills (plus any supporting files) |
| `agents/<name>.md` | subagents |
| `profile.json` | optional, `{ "description": "..." }`, shown in the panel |
| `settings.json` | plugins and marketplaces only, never permissions. **Only `base` counts**; it is ignored in every other profile |

A folder with none of `CLAUDE.md`, `skills/` or `agents/` is skipped. Symlinks,
names that do not match the pattern, and anything resolving outside `configs/`
are skipped with a warning in the panel and never followed.

`configs/example/` is a template; copy it to create a profile. For where profiles fit in a deploy, see the [README](../README.md#9-config-profiles).

## Merge order and clashes

- `base` is always loaded, first. It is the only profile whose `settings.json` is used.
- The remaining selected profiles follow in alphabetical order.
- `CLAUDE.md` files are concatenated, each under a `# Profile: <name>` heading.
- If two profiles define the same skill or agent, the later profile wins
  (alphabetical order, so `security` beats `frontend`). The panel shows the clash
  before you start the session.

## How it reaches a session

The panel merges the selected profiles and copies the result to
`/opt/session-config` in the session container. At boot
`runner/bin/assemble-home.mjs` copies it into `~/.claude`, then layers the
session overlay (`runner/overlay/`) on top:

- `settings.json`: permission rules, `apiKeyHelper` and anything containing a
  Windows path are dropped; the session's permission mode and hooks are added.
- `CLAUDE.md`: the session rules (`runner/overlay/CLAUDE.session.md`) are
  appended, replacing this machine's "confirm before push/delete" rules.
- Plugins listed in `enabledPlugins` are installed from `extraKnownMarketplaces`.

Changes reach **new** sessions after you commit and redeploy. Running sessions
keep what they started with.

## Never put in here

- `.credentials.json`, OAuth or API tokens, `apiKeyHelper` scripts
- `.env*` files or any secret value (use the panel's per-repo secrets)
- `projects/`, `history.jsonl`, `plugins/cache/`, or other machine state
- Windows-only settings (status lines, PowerShell hooks, `C:\` paths)
