'use client';

import { useEffect, useState } from 'react';

const TICK_MS = 30_000;

/** "Now" for countdowns and relative times, advanced every 30 s. Fresh data arrives over the live stream, not by polling. */
export function useClock(initial: Date): Date {
  const [tick, setTick] = useState<Date | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setTick(new Date()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // A pushed snapshot carries a newer renderedAt than the last tick; never show an older "now".
  return tick && tick > initial ? tick : initial;
}
