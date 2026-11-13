import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, copyFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cpuPct, parseCpuTimes, parseMeminfo, collectStats } from "../stats.mjs";
import { createServer } from "../server.mjs";

const fixture = (name) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");

test("cpu pct from two samples is exact", () => {
  const a = parseCpuTimes(fixture("stat-1"));
  const b = parseCpuTimes(fixture("stat-2"));
  assert.deepEqual(a, { total: 10000, idle: 8500 });
  assert.deepEqual(b, { total: 11000, idle: 9200 });
  assert.equal(cpuPct(a, b), 30);
});

test("cpu pct is 0 when no time elapsed", () => {
  const a = parseCpuTimes(fixture("stat-1"));
  assert.equal(cpuPct(a, a), 0);
});

test("parseCpuTimes rejects garbage", () => {
  assert.throws(() => parseCpuTimes("nonsense"));
});

test("meminfo parses kB into bytes", () => {
  assert.deepEqual(parseMeminfo(fixture("meminfo")), {
    totalBytes: 16384000 * 1024,
    availableBytes: 8192000 * 1024,
  });
});

test("meminfo without MemAvailable throws", () => {
  assert.throws(() => parseMeminfo("MemTotal: 1 kB\n"));
});

function makeRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "hoststats-"));
  mkdirSync(path.join(root, "proc"));
  mkdirSync(path.join(root, "docker"));
  copyFileSync(new URL("./fixtures/meminfo", import.meta.url), path.join(root, "proc", "meminfo"));
  return root;
}

test("collectStats assembles the documented shape", async () => {
  const root = makeRoot();
  const samples = [fixture("stat-1"), fixture("stat-2")];
  const stats = await collectStats({
    procDir: path.join(root, "proc"),
    dockerDir: path.join(root, "docker"),
    readStat: async () => samples.shift(),
    sleep: async () => {},
  });
  assert.equal(stats.cpu.pct, 30);
  assert.equal(stats.memory.totalBytes, 16384000 * 1024);
  assert.equal(stats.disk.path, path.join(root, "docker"));
  assert.ok(stats.disk.totalBytes > 0 && stats.disk.freeBytes >= 0);
  assert.deepEqual(Object.keys(stats).sort(), ["cpu", "disk", "memory"]);
});

test("server serves /stats and 404s everything else", async () => {
  const server = createServer({ collect: async () => ({ ok: true }) });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const ok = await fetch(`${base}/stats`);
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true });
    for (const p of ["/", "/stats/", "/stats/x", "/health"]) {
      assert.equal((await fetch(`${base}${p}`)).status, 404, p);
    }
    assert.equal((await fetch(`${base}/stats`, { method: "POST" })).status, 404);
  } finally {
    server.close();
  }
});

test("server returns 500 when collection fails", async () => {
  const server = createServer({
    collect: async () => {
      throw new Error("boom");
    },
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/stats`);
    assert.equal(res.status, 500);
  } finally {
    server.close();
  }
});
