import { describe, expect, it, vi } from 'vitest';
import { createSchedulerLoop } from '@/scheduler/scheduler-loop';

const NOW = new Date('2026-11-14T10:00:00Z');
const make = (jobs: Parameters<typeof createSchedulerLoop>[0]) => {
  const warn = vi.fn();
  return { warn, loop: createSchedulerLoop(jobs, { intervalMs: 30_000, now: () => NOW, warn }) };
};

describe('scheduler loop', () => {
  it('runs every job each tick', async () => {
    const a = vi.fn().mockResolvedValue(undefined);
    const b = vi.fn().mockResolvedValue(undefined);
    const { loop } = make([
      { name: 'a', run: a },
      { name: 'b', run: b },
    ]);
    await loop.tick();
    await loop.tick();
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledWith(NOW);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('one failing job does not stop the others', async () => {
    const ok = vi.fn().mockResolvedValue(undefined);
    const { loop, warn } = make([
      { name: 'bad', run: () => Promise.reject(new Error('boom')) },
      { name: 'ok', run: ok },
    ]);
    await loop.tick();
    expect(ok).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[scheduler] bad failed: boom');
  });

  it('skips a tick while the previous one runs', async () => {
    let release!: () => void;
    const run = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const { loop } = make([{ name: 'slow', run }]);
    const first = loop.tick();
    await loop.tick();
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await first;
    void loop.tick();
    expect(run).toHaveBeenCalledTimes(2);
    release();
  });
});
