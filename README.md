# ClaudeCloud

A self-hosted panel for running Claude Code sessions on your own VPS. Each session is an isolated container that clones one of your GitHub repositories, works on a branch and opens a pull request. You start, watch and stop sessions from a web panel, and can continue any of them from the Claude app through Remote Control.

> [!IMPORTANT]
> **Install the Sysbox runtime on the VPS host once, before you deploy.**
> Coolify and the compose stack cannot do this for you. Without Sysbox, sessions will not start, and the panel shows a red "no sysbox-runc runtime" banner.
>
> - **Supported:** Ubuntu 20.04 / 22.04 / 24.04 or Debian 11 / 12, kernel 5.12 or newer recommended (details in [`docs/vps-setup.md`](docs/vps-setup.md#1-check-the-host-is-supported)).
> - **Installing restarts the host's Docker daemon.** Every container on the box restarts briefly, Coolify's own included. Do it in a quiet moment.
> - **Commands:** [`docs/vps-setup.md`, "3. Install Sysbox"](docs/vps-setup.md#3-install-sysbox).
> - **Verify** from a checkout of this repo on the VPS: `bash runner/scripts/verify-sysbox.sh`. Expect `SYSBOX OK`.

<!-- screenshot: docs/images/panel-sessions.png (Sessions page) -->

## 2. What it is

ClaudeCloud is one Docker Compose stack: a Next.js panel, a Postgres database, a locked-down Docker socket proxy, a host stats sidecar and a build-only step for the session image. Sessions run under Sysbox, so each one can have its own Docker daemon without touching the host's. The panel is the only way in, and Cloudflare Access is its only login.

Each session uses your Claude subscription and GitHub App. Everything is stored in your own Postgres and Coolify environment. Nothing is shared with anyone else.

## 3. What you need

- A VPS running [Coolify](https://coolify.io), with Sysbox installed (see the notice above)
- A domain on Cloudflare
- A Claude Pro, Max or Ultra subscription
- A GitHub account (and any organizations whose repositories you want sessions to use)

## 4. Choose what to deploy

No fork or private copy is needed. Coolify deploys this public repository directly:

| Branch | Use |
|---|---|
| `live` | The stable release. Deploy this one. |
| `main` | Ongoing development. It can be ahead of `live` and is not guaranteed stable. |

Everything personal lives outside the repository: your email and Cloudflare values are Coolify environment variables, and Claude, GitHub and repo secrets are connected in the panel.

## 5. Install Sysbox

Follow [`docs/vps-setup.md`](docs/vps-setup.md) and run `bash runner/scripts/verify-sysbox.sh` until it prints `SYSBOX OK`. It also covers rollback, and the fallback if your kernel or distro is unsupported. See the notice at the top for what installing does to running containers.

## 6. Deploy on Coolify

1. In Coolify: **Add resource** > **Public Repository**, enter `https://github.com/Khost-web-za/AutoClaude`, set the branch to `live`, and choose the **Docker Compose** build pack. Leave the compose file at the repo root (`docker-compose.yml`).
2. Set these in the resource's **Environment Variables** tab, not by editing the compose file (a redeploy would overwrite edits). The deploy refuses to start without them.

   | Variable | Value |
   |---|---|
   | `ALLOWED_EMAIL` | The one owner. Matched case-insensitively against the Cloudflare Access email. |
   | `CF_ACCESS_TEAM_DOMAIN` | Your Access team domain, e.g. `myteam.cloudflareaccess.com` |
   | `CF_ACCESS_AUD` | The Access application's AUD tag (see [step 7](#7-put-it-behind-cloudflare-access)) |

3. Coolify generates these itself. Do not set them:

   | Variable | What it becomes |
   |---|---|
   | `SERVICE_FQDN_PANEL_3000` | The panel's public domain, routed to port 3000. The only published port. |
   | `SERVICE_URL_PANEL` | `https://<that domain>`, passed to the panel as `PANEL_PUBLIC_URL` |
   | `SERVICE_PASSWORD_POSTGRES` | The Postgres password |
   | `SERVICE_REALBASE64_ENCRYPTION` | Base64 of 32 random bytes, passed to the panel as `PANEL_ENCRYPTION_KEY` |

   The key uses `SERVICE_REALBASE64_ENCRYPTION`, not `SERVICE_BASE64_*`. Coolify's `SERVICE_BASE64_*` is a 32-character alphanumeric string, which is not 32 random bytes. **Losing this value loses every stored secret** (the Claude login backup, the GitHub App key and repo secrets), so keep a copy of it somewhere safe.

4. Under **Advanced > Build**, set **Source commit availability** to **Available during build**. Otherwise `SOURCE_COMMIT` is empty at build time and every deploy re-tags the runner image `claudecloud-runner:local`. Sessions still use the fresh build, but no image is kept per commit.
5. Optional variables: `SESSION_RUNTIME` (default `sysbox-runc`), `GITHUB_API_URL` (GitHub Enterprise), and `STACK_NETWORK` / `CLAUDE_AUTH_VOLUME` (only if the panel cannot discover its own network and volume through Docker).
6. Deploy.

Session containers run on a dedicated `sessions` network that only the panel joins. Postgres, hoststats and the Docker socket proxy are unreachable from sessions. The panel refuses to start a session on any network that is shared with docker-proxy, has a `docker.sock` mount, or holds Postgres.

> [!NOTE]
> If you deployed a version from before the `sessions` network existed, **redeploy the stack** before sessions will start.

## 7. Put it behind Cloudflare Access

The panel has no login of its own. It trusts only a valid Cloudflare Access token for your team and application, and rejects everything else with a 403.

1. Point your domain at the VPS in Cloudflare DNS (proxied), and make sure the panel's domain is set in Coolify.
2. In Cloudflare **Zero Trust > Access > Applications**, add a **Self-hosted** application for the panel's hostname, covering every path.
3. Add a policy that allows only your email (the same address as `ALLOWED_EMAIL`).
4. Choose a session duration. When it ends you sign in again, and the Connections page shows when your login expires.
5. Copy the application's **Application Audience (AUD) tag** from its overview into `CF_ACCESS_AUD`. Your team domain (`CF_ACCESS_TEAM_DOMAIN`) is `<team name>.cloudflareaccess.com`.
6. Redeploy after changing either value.

Check **Connections > Cloudflare** in the panel: the self-check should read "Enforced".

## 8. First run in the panel

Open the Sessions page. Until Claude and GitHub are connected it shows a setup checklist that links to **Connections**.

1. **Claude.** Connections > Claude. Start a login helper, open the link it gives you and approve with your Claude account, then paste the code Claude shows you back into the panel.
2. **GitHub App.** Connections > GitHub > Create GitHub App. GitHub's manifest flow creates an App with exactly the permissions sessions need (contents, pull requests, workflows; no webhooks) and returns its keys to the panel. Leave the organization field empty for your personal account.
3. **Install it** on your account or organizations, choosing which repositories sessions may use ("Install on an account"). Use "Sync" if installations don't show up.
4. **Authorize as you** ("Authorize as me") so pull requests and commits are authored by you.

> [!WARNING]
> **GitHub trade-off.** In user mode, PRs and commits are authored as you through user-to-server tokens, and GitHub cannot scope those to one repository. A compromised session container could reach any of your other App-accessible repositories until the token expires (about 8 hours). If you don't authorize as yourself, PRs open as the App, and each session gets a token for its own repository only. Install the App only on the repositories you want sessions to use.

## 9. Config profiles

`configs/` holds Claude Code setups for sessions (instructions, skills, subagents) as folders called profiles. `base` is always loaded; you pick the rest per session. To add your own, copy `configs/example/` to a new folder and edit it. Changes reach new sessions after you commit and redeploy. The details are in [`configs/README.md`](configs/README.md).

Keep `base` mostly as it is, because that is the only place upstream updates can conflict with your changes. Put your personal rules in a profile of your own and tick it in every session.

## 10. Schedule and auto-resume

**Kick-offs.** A kick-off starts your 5-hour usage window at a time you choose, so it resets when you want it to. Add one on the Schedule page, in the time zone set in Settings. At that time the panel runs Claude Code once with Haiku in a short-lived container, sending a single "." prompt. If a window is already running, the kick-off is skipped. If the panel was down for more than 30 minutes past the chosen time, it is marked missed and does not run late.

**Auto-resume.** When a session hits its usage limit, auto-resume can continue it for you. It is off by default. Turn it on as a default per repository, or with the switch on a single session. The repository also holds the resume message. After the limit resets, the panel:

- types the resume message at reset + 1 minute, and tries again at +6 and +16 minutes;
- relaunches Claude with `--continue` at +18 minutes;
- gives up at +21 minutes.

It never types over a permission prompt or a question from Claude. If the limit keeps coming back, it types one message per real reset. **Resume now** on a session does the same without waiting.

**Usage bars.** The bars keep the last good reading. When it is older than 3 minutes they show "as of HH:mm" instead of jumping to empty.

> [!NOTE]
> Limit detection reads Claude's screen. If a Claude Code update changes how the limit message looks, the detection patterns may need updating.

## 11. Updating and redeploying

Redeploy in Coolify to pick up the latest `live` (or turn on auto-deploy for the resource). Database migrations run automatically when the panel container starts, and a failed migration stops it before it serves anything. Running sessions keep the image and config they started with. New sessions use the new ones.

Maintainers release by merging `main` into `live`:

```bash
git switch live && git merge --ff-only main && git push origin live
```

## 12. Local development

```bash
cp .env.example .env.local                        # fill in PANEL_ENCRYPTION_KEY: openssl rand -base64 32
docker compose -f docker-compose.local.yml up -d  # local Postgres on 127.0.0.1:55430
pnpm --dir panel install
pnpm --dir panel db:migrate
pnpm --dir panel dev                              # http://localhost:3000
```

`.env.local` (git-ignored) is read from the repo root. `CF_ACCESS_DEV_BYPASS_EMAIL` acts as that user without a Cloudflare token and is rejected when `NODE_ENV=production`.

```bash
pnpm --dir panel test               # unit tests
pnpm --dir panel test:integration   # against the local Postgres
pnpm --dir panel typecheck && pnpm --dir panel lint
npm --prefix runner test            # runner tests
```

The Playwright smoke test (`pnpm --dir panel test:e2e`) runs against `docker-compose.e2e.yml`, a production build of the stack with stubs for Cloudflare Access, GitHub and Claude and without Sysbox. Its header comment has the commands. The runner API contract is in [`docs/runner-contract.md`](docs/runner-contract.md).

## 13. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Banner: "The Docker host has no sysbox-runc runtime" | Sysbox isn't installed, or Docker was not restarted after installing it. See [`docs/vps-setup.md`](docs/vps-setup.md), then `bash runner/scripts/verify-sysbox.sh`. |
| Banner: "The Claude login has expired" or "Claude is not connected" | Connections > Claude > re-connect. Sessions cannot start until you do. |
| `403 Forbidden` on every page | The request has no valid Access token. Check that the Access application covers the hostname and every path, that `CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN` match it, and that you sign in with the `ALLOWED_EMAIL` address. |
| Deploy refuses to start | A required variable is missing (`ALLOWED_EMAIL`, `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`), or `PANEL_ENCRYPTION_KEY` is not 32 bytes of base64 (use `SERVICE_REALBASE64_ENCRYPTION`). |
| Sessions won't start after upgrading | Redeploy the stack so the `sessions` network exists. The panel also refuses to start a session on a network shared with docker-proxy, a `docker.sock` mount or Postgres. |
| A repository is missing, or "install the App" | The GitHub App isn't installed on that repository's owner. Connections > GitHub > Install on an account, then Sync. |
| Every deploy re-tags the runner image `:local` | Set Coolify's "Source commit availability" to "Available during build" ([step 6](#6-deploy-on-coolify)). |

## Repository layout

| Path | What |
|---|---|
| `panel/` | The Next.js panel |
| `runner/` | The session container image and its scripts |
| `hoststats/` | The host stats sidecar (disk, CPU, memory) |
| `configs/` | Claude Code config profiles |
| `docs/` | VPS setup and runner contract |
| `docker-compose.yml` | The production stack for Coolify |
| `docker-compose.local.yml` | Local Postgres for development |
