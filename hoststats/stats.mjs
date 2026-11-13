import { readFile, statfs } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const SAMPLE_GAP_MS = 500;

/** Aggregate "cpu" line of /proc/stat: total jiffies and idle (idle + iowait). */
export function parseCpuTimes(text) {
  const line = text.split("\n").find((l) => /^cpu\s/.test(l));
  if (!line) throw new Error("no aggregate cpu line in stat");
  // user nice system idle iowait irq softirq steal (guest time is already inside user/nice)
  const f = line.trim().split(/\s+/).slice(1, 9).map(Number);
  if (f.length < 5 || f.some((n) => !Number.isFinite(n))) throw new Error("malformed cpu line in stat");
  return { total: f.reduce((a, b) => a + b, 0), idle: f[3] + f[4] };
}

/** Busy share between two samples, 0-100, one decimal. */
export function cpuPct(before, after) {
  const total = after.total - before.total;
  if (total <= 0) return 0;
  const busy = total - (after.idle - before.idle);
  return Math.round(Math.min(100, Math.max(0, (busy / total) * 100)) * 10) / 10;
}

/** MemTotal and MemAvailable (kB in the file) as bytes. */
export function parseMeminfo(text) {
  const kb = (key) => {
    const m = text.match(new RegExp(String.raw`^${key}:\s+(\d+)\s*kB`, "m"));
    if (!m) throw new Error(`meminfo is missing ${key}`);
    return Number(m[1]) * 1024;
  };
  return { totalBytes: kb("MemTotal"), availableBytes: kb("MemAvailable") };
}

export async function collectStats({
  procDir = process.env.HOST_PROC_DIR ?? "/host/proc",
  dockerDir = process.env.HOST_DOCKER_DIR ?? "/host/docker",
  readStat = () => readFile(path.join(procDir, "stat"), "utf8"),
  sleep = () => delay(SAMPLE_GAP_MS),
} = {}) {
  const first = parseCpuTimes(await readStat());
  await sleep();
  const second = parseCpuTimes(await readStat());
  const [meminfo, fs] = await Promise.all([readFile(path.join(procDir, "meminfo"), "utf8"), statfs(dockerDir)]);
  return {
    disk: { totalBytes: fs.blocks * fs.bsize, freeBytes: fs.bavail * fs.bsize, path: dockerDir },
    cpu: { pct: cpuPct(first, second) },
    memory: parseMeminfo(meminfo),
  };
}
