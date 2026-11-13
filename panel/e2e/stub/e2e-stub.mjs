// e2e only: everything outside the stack the panel and the sessions talk to, in one tiny server.
//   /cdn-cgi/access/certs  Cloudflare Access JWKS (the panel's CF_ACCESS_JWKS_URL)
//   /test/access-key       the matching private key, for Playwright to sign Access tokens (e2e port only)
//   /api/...               the GitHub REST endpoints the panel calls (the panel's GITHUB_API_URL)
//   /git/<owner>/<name>.git a bare repo served over git's "dumb" HTTP (SESSION_REPO_URL_TEMPLATE)
import { execFileSync } from "node:child_process";
import { createReadStream, mkdirSync, mkdtempSync, statSync } from "node:fs";
import http from "node:http";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

const PORT = Number(process.env.PORT ?? 8080);
const GIT_ROOT = "/srv/git";
// Holds the first clone back so the Starting status is observable before the session reaches Working.
const CLONE_DELAY_MS = Number(process.env.CLONE_DELAY_MS ?? 3000);

const OWNER = "e2e-owner";
const REPO = "hello-world";
const APP = { id: 4242, slug: "claudecloud-e2e" };
const INSTALLATION_ID = 777;
const ACCESS_KID = "e2e-access";

// --- Cloudflare Access signing key (fresh per stack start) -------------------------------------------
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwks = { keys: [{ ...publicKey.export({ format: "jwk" }), kid: ACCESS_KID, alg: "RS256", use: "sig" }] };
const accessKey = { kid: ACCESS_KID, pem: privateKey.export({ type: "pkcs8", format: "pem" }) };

// --- the bare repo -----------------------------------------------------------------------------------
function createRepo() {
  const bare = path.join(GIT_ROOT, OWNER, `${REPO}.git`);
  mkdirSync(path.dirname(bare), { recursive: true });
  const work = mkdtempSync(path.join(tmpdir(), "seed-"));
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: "pipe" });
  git(work, "init", "-q", "-b", "main");
  git(work, "-c", "user.name=e2e", "-c", "user.email=e2e@example.com", "commit", "-q", "--allow-empty", "-m", "Initial commit");
  git(GIT_ROOT, "clone", "-q", "--bare", work, bare);
  git(bare, "update-server-info");
}

// --- GitHub REST stub --------------------------------------------------------------------------------
const installation = { id: INSTALLATION_ID, account: { login: OWNER, type: "User" } };
const repository = {
  full_name: `${OWNER}/${REPO}`,
  private: true,
  default_branch: "main",
  pushed_at: "2026-11-01T00:00:00Z",
};

function github(method, route) {
  if (method === "GET" && route === "/app") {
    return { ...APP, html_url: `https://github.com/apps/${APP.slug}`, owner: { login: OWNER } };
  }
  if (method === "GET" && route === "/app/installations") return [installation];
  if (method === "GET" && route === `/app/installations/${INSTALLATION_ID}`) return installation;
  if (method === "POST" && route === `/app/installations/${INSTALLATION_ID}/access_tokens`) {
    return { token: `ghs_e2e${randomBytes(8).toString("hex")}`, expires_at: new Date(Date.now() + 3600_000).toISOString() };
  }
  if (method === "GET" && route === "/installation/repositories") return { total_count: 1, repositories: [repository] };
  if (method === "GET" && route === `/repos/${OWNER}/${REPO}/branches`) return [{ name: "main", protected: false }];
  const user = /^\/users\/([^/]+)$/.exec(route);
  if (method === "GET" && user) return { id: 41000001, login: decodeURIComponent(user[1]) };
  return null;
}

// --- server ------------------------------------------------------------------------------------------
const json = (res, status, body) =>
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));

let cloneHeld = false;

function serveGit(res, pathname) {
  const file = path.normalize(path.join(GIT_ROOT, pathname.slice("/git/".length)));
  if (!file.startsWith(`${GIT_ROOT}/`)) return res.writeHead(404).end();
  let size;
  try {
    const stat = statSync(file);
    if (!stat.isFile()) return res.writeHead(404).end();
    size = stat.size;
  } catch {
    return res.writeHead(404).end();
  }
  const send = () => {
    res.writeHead(200, { "content-type": "application/octet-stream", "content-length": size });
    createReadStream(file).pipe(res);
  };
  if (!cloneHeld && pathname.endsWith("/info/refs")) {
    cloneHeld = true;
    setTimeout(send, CLONE_DELAY_MS);
  } else {
    send();
  }
}

createRepo();
http
  .createServer((req, res) => {
    const { pathname } = new URL(req.url ?? "/", "http://stub");
    console.log(`[stub] ${req.method} ${pathname}`);
    if (pathname === "/health") return res.writeHead(200).end("ok");
    if (pathname === "/cdn-cgi/access/certs") return json(res, 200, jwks);
    if (pathname === "/test/access-key") return json(res, 200, accessKey);
    if (pathname.startsWith("/git/") && req.method === "GET") return serveGit(res, pathname);
    if (pathname.startsWith("/api/")) {
      const body = github(req.method, pathname.slice("/api".length));
      return body === null ? json(res, 404, { message: "Not Found" }) : json(res, req.method === "POST" ? 201 : 200, body);
    }
    res.writeHead(404).end();
  })
  .listen(PORT, "0.0.0.0", () => console.log(`[stub] listening on :${PORT}`));
