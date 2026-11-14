'use client';

import { useEffect, useRef } from 'react';
import type { LiveEvent } from './event-bus';

const LIVE_KINDS = ['session', 'session_event', 'usage', 'host', 'kickoffs', 'session_limit'] as const satisfies readonly LiveEvent['kind'][];
const BACKOFF_START_MS = 3000;
const BACKOFF_MAX_MS = 30_000;

type LiveHandler = (event: LiveEvent) => void;

// One EventSource per tab, shared by every component that calls useLive. It opens with the first
// subscriber and closes with the last. EventSource retries network errors by itself, but a non-200 or
// non-event-stream reply (a proxy 502 during a redeploy, an expired Access session) closes it for
// good, so onerror reopens with backoff for as long as anyone is listening.
const handlers = new Set<LiveHandler>();
let source: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let backoffMs = BACKOFF_START_MS;
let wakeListenersAttached = false;

function dispatch(message: MessageEvent<string>) {
  let event: LiveEvent;
  try {
    event = JSON.parse(message.data) as LiveEvent;
  } catch {
    return;
  }
  for (const handler of [...handlers]) handler(event);
}

function clearReconnectTimer() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function scheduleReconnect() {
  if (reconnectTimer || handlers.size === 0) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    open();
  }, backoffMs);
  backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
}

function open() {
  if (source || handlers.size === 0) return;
  const next = new EventSource('/api/live');
  source = next;
  next.onopen = () => {
    backoffMs = BACKOFF_START_MS;
  };
  next.onerror = () => {
    if (next.readyState !== EventSource.CLOSED) return; // CONNECTING: the browser is retrying itself
    next.close();
    if (source === next) source = null;
    scheduleReconnect();
  };
  for (const kind of LIVE_KINDS) next.addEventListener(kind, (message) => dispatch(message as MessageEvent<string>));
}

/** A tab coming back or the network returning: do not wait out the backoff. */
function wake() {
  if (document.visibilityState === 'hidden' || source || handlers.size === 0) return;
  clearReconnectTimer();
  backoffMs = BACKOFF_START_MS;
  open();
}

function attachWakeListeners() {
  if (wakeListenersAttached) return;
  wakeListenersAttached = true;
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('online', wake);
}

function detachWakeListeners() {
  if (!wakeListenersAttached) return;
  wakeListenersAttached = false;
  document.removeEventListener('visibilitychange', wake);
  window.removeEventListener('online', wake);
}

/** Exported for tests; components use useLive. */
export function subscribeForTests(handler: LiveHandler): () => void {
  return subscribe(handler);
}

function subscribe(handler: LiveHandler): () => void {
  handlers.add(handler);
  attachWakeListeners();
  open();
  return () => {
    handlers.delete(handler);
    if (handlers.size === 0) {
      clearReconnectTimer();
      detachWakeListeners();
      source?.close();
      source = null;
      backoffMs = BACKOFF_START_MS;
    }
  };
}

/** Calls `onEvent` for every live event pushed by /api/live. Pages must render fully without it. */
export function useLive(onEvent: (event: LiveEvent) => void): void {
  const latest = useRef(onEvent);
  useEffect(() => {
    latest.current = onEvent;
  });
  useEffect(() => subscribe((event) => latest.current(event)), []);
}
