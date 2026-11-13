export type HostStats = {
  disk: { totalBytes: number; freeBytes: number; path: string };
  cpu: { pct: number };
  memory: { totalBytes: number; availableBytes: number };
};
