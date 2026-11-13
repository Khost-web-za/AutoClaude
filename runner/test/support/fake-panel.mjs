// Fake panel implementing the runner contract (docs/runner-contract.md) for tests.
import http from "node:http";

export async function startFakePanel(opts = {}) {
  const {
    secrets = {},
    credential = { username: "x-access-token", password: "ghs_test_token", expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
    failFirst = 0,
    down = false,
    sessionId = "sess-1",
    sessionSecret = "secret-1",
    host = "127.0.0.1",
    port: listenPort = 0,
  } = opts;

  const events = [];
  const requests = [];
  let failuresLeft = failFirst;

  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    requests.push({ method: req.method, path: req.url, headers: req.headers, body: raw });

    if (down) {
      req.socket.destroy();
      return;
    }
    if (failuresLeft > 0) {
      failuresLeft--;
      res.writeHead(500).end();
      return;
    }
    if (req.headers.authorization !== `Bearer ${sessionSecret}` || req.headers["x-session-id"] !== sessionId) {
      res.writeHead(401).end();
      return;
    }

    const json = (status, body) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return json(400, { error: "invalid json" });
    }

    if (req.method === "POST" && req.url === "/api/runner/events") {
      events.push(body);
      res.writeHead(204).end();
    } else if (req.method === "POST" && req.url === "/api/runner/git-credential") {
      json(200, credential);
    } else if (req.method === "GET" && req.url === "/api/runner/secrets") {
      json(200, { secrets });
    } else {
      json(404, { error: "not found" });
    }
  });

  await new Promise((resolve) => server.listen(listenPort, host, resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    events,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
