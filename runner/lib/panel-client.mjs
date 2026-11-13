// Minimal client for the panel's runner API (see docs/runner-contract.md).
// Zero dependencies; reads PANEL_URL / SESSION_ID / SESSION_SECRET at call time.

const TOTAL_BUDGET_MS = 10_000;
const FIRST_BACKOFF_MS = 250;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function panelEnv() {
  const { PANEL_URL, SESSION_ID, SESSION_SECRET } = process.env;
  if (!PANEL_URL || !SESSION_ID || !SESSION_SECRET) {
    throw new Error("PANEL_URL, SESSION_ID and SESSION_SECRET must be set");
  }
  return { baseUrl: PANEL_URL.replace(/\/+$/, ""), sessionId: SESSION_ID, secret: SESSION_SECRET };
}

/**
 * Calls the panel with auth headers. Retries network errors and 5xx with
 * exponential backoff (250 ms, 500 ms, …). `retries` is the maximum number of
 * attempts; the whole call never exceeds ~10 s. Resolves with the Response for
 * any non-5xx status; throws once attempts or time run out.
 */
export async function panelRequest(method, path, body, opts = {}) {
  const { retries = 5, timeoutMs = 3_000 } = opts;
  const { baseUrl, sessionId, secret } = panelEnv();
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const headers = { authorization: `Bearer ${secret}`, "x-session-id": sessionId };
  if (body !== undefined) headers["content-type"] = "application/json";

  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      const res = await fetch(baseUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(Math.min(timeoutMs, remaining)),
      });
      if (res.status < 500) return res;
      await res.body?.cancel();
      lastError = new Error(`panel responded ${res.status} for ${method} ${path}`);
    } catch (err) {
      lastError = new Error(`panel request ${method} ${path} failed: ${err.cause?.code ?? err.name}`);
    }
    if (attempt < retries) {
      const wait = FIRST_BACKOFF_MS * 2 ** (attempt - 1);
      if (Date.now() + wait >= deadline) break;
      await sleep(wait);
    }
  }
  throw lastError ?? new Error(`panel request ${method} ${path} timed out`);
}

/** Posts a runner event. Never throws; resolves false if it could not be delivered. */
export async function postEvent(type, data = {}, opts = {}) {
  try {
    const res = await panelRequest("POST", "/api/runner/events", { type, data, at: new Date().toISOString() }, opts);
    await res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  }
}
