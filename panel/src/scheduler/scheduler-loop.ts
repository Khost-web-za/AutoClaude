import { db } from '@/db/client';
import { eventBus } from '@/live/event-bus';
import { readSettings } from '@/settings/settings-store';
import { runKickoffContainer } from '@/kickoffs/kickoff-container';
import { runKickoffJob } from '@/kickoffs/kickoff-job';
import { getUsageResult, refreshUsage } from '@/usage/usage-client';

const SCHEDULER_INTERVAL_MS = 30_000;

export type SchedulerJob = { name: string; run: (now: Date) => Promise<void> };

export type SchedulerLoopOptions = { intervalMs: number; now: () => Date; warn: (message: string) => void };

export function createSchedulerLoop(jobs: SchedulerJob[], opts: SchedulerLoopOptions) {
  let inFlight = false;
  let timer: NodeJS.Timeout | undefined;

  async function tick(): Promise<void> {
    if (inFlight) return; // a slow job must not stack overlapping ticks
    inFlight = true;
    try {
      const now = opts.now();
      const results = await Promise.allSettled(jobs.map((job) => job.run(now)));
      results.forEach((result, index) => {
        const name = jobs[index]?.name ?? 'job';
        if (result.status !== 'rejected') return;
        const reason: unknown = result.reason;
        opts.warn(`[scheduler] ${name} failed: ${reason instanceof Error ? reason.message : 'error'}`);
      });
    } finally {
      inFlight = false;
    }
  }

  function start(): void {
    if (timer) return;
    void tick();
    timer = setInterval(() => void tick(), opts.intervalMs);
    timer.unref();
  }

  function stop(): void {
    if (timer) clearInterval(timer);
    timer = undefined;
  }

  return { tick, start, stop };
}

const globalForScheduler = globalThis as typeof globalThis & {
  __schedulerLoop?: ReturnType<typeof createSchedulerLoop>;
};

/** Starts the shared scheduler once per process. */
export function startSchedulerLoop(): void {
  if (globalForScheduler.__schedulerLoop) return;
  const jobs: SchedulerJob[] = [
    {
      name: 'kickoffs',
      run: (now) =>
        runKickoffJob(
          {
            db,
            runContainer: () => runKickoffContainer(),
            getUsage: getUsageResult,
            refreshUsage,
            publish: (event) => eventBus.publish(event),
            timeZone: async () => (await readSettings(db)).timeZone,
          },
          now,
        ),
    },
  ];
  globalForScheduler.__schedulerLoop = createSchedulerLoop(jobs, {
    intervalMs: SCHEDULER_INTERVAL_MS,
    now: () => new Date(),
    warn: (message) => console.warn(message),
  });
  globalForScheduler.__schedulerLoop.start();
}
