# Runner contract (shared by runner and panel)

Change the panel and runner sides together.


Env in (set by panel at container create):

| Var | Meaning |
|---|---|
| `SESSION_ID` | panel session id |
| `SESSION_SECRET` | bearer secret for all callbacks |
| `PANEL_URL` | internal base URL, e.g. `http://panel:3000` |
| `REPO_FULL_NAME` | `owner/name` |
| `REPO_URL` | optional clone URL override (tests use a `file://` bare repo); default `https://github.com/$REPO_FULL_NAME.git` |
| `BASE_BRANCH` | branch to start from |
| `DEFAULT_BRANCH` | repo default branch (for push guard) |
| `WORK_BRANCH` | branch to create |
| `STARTING_TASK_B64` | optional, base64 UTF-8 starting task |
| `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` | commit identity |
| `SESSION_DOCKER` | `true` to start inner dockerd (Sysbox only) |
| `CLAUDE_BIN` | optional override of the claude executable (tests use a stub) |

Callbacks (all `Authorization: Bearer $SESSION_SECRET`, `X-Session-Id: $SESSION_ID`, JSON):

- `POST /api/runner/events` body `{ "type": EventType, "data": object, "at": ISO8601 }` → `204`. `EventType` = `boot_step` (`data.step`: `docker|clone|branch|config|secrets|launch`, `data.status`: `started|done|failed`, `data.error?`) · `remote_control_url` (`data.url`) · `hook` (`data.event`: `SessionStart|UserPromptSubmit|Notification|Stop`, `data.message?`) · `claude_exited` (`data.code`, `data.restarting: boolean`, `data.fatal: boolean`).
- `POST /api/runner/git-credential` body `{ "repo": "owner/name" }` → `200 { "username": "x-access-token", "password": string, "expiresAt": ISO8601 }`.
- `GET /api/runner/secrets` → `200 { "secrets": { [key: string]: string } }`.

