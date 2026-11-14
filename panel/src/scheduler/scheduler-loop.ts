import { runResumeJob } from '@/auto-resume/resume-job';
import { capturePane, requestRelaunch, typeIntoClaude } from '@/auto-resume/session-keys';
import { db } from '@/db/client';
import { docker } from '@/docker/docker-client';
import { eventBus } from '@/live/event-bus';
import { readResumeMessages } from '@/repos/repo-settings-store';
import { readSettings } from '@/settings/settings-store';
import { runKickoffContainer } from '@/kickoffs/kickoff-container';
import { runKickoffJob } from '@/kickoffs/kickoff-job';
import { getUsageResult, refreshUsage } from '@/usage/usage-client';

const SCHEDULER_INTERVAL_MS = 30_000;
/** Runner images set no TZ, so Claude prints reset times in UTC unless it names a zone. */
const RUNNER_TIME_ZONE = 'UTC';

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
    {
      name: 'auto-resume',
      run: (now) =>
        runResumeJob(
          {
            db,
            capturePane: (containerId) => capturePane({ docker }, docker.getContainer(containerId)),
            typeIntoClaude: (containerId, text, opts) => typeIntoClaude({ docker }, docker.getContainer(containerId), text, opts),
            requestRelaunch: (containerId, message) => requestRelaunch({ docker }, docker.getContainer(containerId), message),
            getUsage: getUsageResult,
            publish: (event) => eventBus.publish(event),
            resumeMessagesFor: (repoFullNames) => readResumeMessages(repoFullNames, db),
            containerTimeZone: RUNNER_TIME_ZONE,
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
