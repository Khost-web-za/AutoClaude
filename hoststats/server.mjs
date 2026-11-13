import http from "node:http";
import { fileURLToPath } from "node:url";
import { collectStats } from "./stats.mjs";

export function createServer({ collect = collectStats } = {}) {
  return http.createServer(async (req, res) => {
    const pathname = new URL(req.url ?? "/", "http://hoststats").pathname;
    if (req.method !== "GET" || pathname !== "/stats") {
      res.writeHead(404).end();
      return;
    }
    try {
      const body = JSON.stringify(await collect());
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(body);
    } catch (error) {
      console.error("[hoststats] collect failed:", error instanceof Error ? error.message : error);
      res.writeHead(500).end();
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 9100);
  createServer().listen(port, "0.0.0.0", () => console.log(`[hoststats] listening on :${port}`));
}
