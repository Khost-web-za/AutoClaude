import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeEventSource {
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener() {}
  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }
  fail(state: number) {
    this.readyState = state;
    this.onerror?.();
  }
}

let fakeDocument: EventTarget;

async function load() {
  vi.resetModules();
  const mod = await import('@/live/use-live');
  return mod;
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  fakeDocument = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('window', new EventTarget());
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('shared live stream', () => {
  it('reopens a closed stream after backoff and shares one source', async () => {
    const { subscribeForTests } = await load();
    const stop1 = subscribeForTests(() => {});
    const stop2 = subscribeForTests(() => {});
    expect(FakeEventSource.instances).toHaveLength(1);

    FakeEventSource.instances[0]!.fail(FakeEventSource.CLOSED);
    expect(FakeEventSource.instances).toHaveLength(1);
    vi.advanceTimersByTime(3000);
    expect(FakeEventSource.instances).toHaveLength(2);

    // still failing: next wait doubles
    FakeEventSource.instances[1]!.fail(FakeEventSource.CLOSED);
    vi.advanceTimersByTime(3000);
    expect(FakeEventSource.instances).toHaveLength(2);
    vi.advanceTimersByTime(3000);
    expect(FakeEventSource.instances).toHaveLength(3);
    stop1();
    stop2();
  });

  it('leaves a CONNECTING error to the browser', async () => {
    const { subscribeForTests } = await load();
    const stop = subscribeForTests(() => {});
    FakeEventSource.instances[0]!.fail(0);
    vi.advanceTimersByTime(60_000);
    expect(FakeEventSource.instances).toHaveLength(1);
    stop();
  });

  it('reopens immediately when the tab becomes visible', async () => {
    const { subscribeForTests } = await load();
    const stop = subscribeForTests(() => {});
    FakeEventSource.instances[0]!.fail(FakeEventSource.CLOSED);
    fakeDocument.dispatchEvent(new Event('visibilitychange'));
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
    stop();
  });

  it('does not reopen or keep a timer after the last unsubscribe', async () => {
    const { subscribeForTests } = await load();
    const stop = subscribeForTests(() => {});
    FakeEventSource.instances[0]!.fail(FakeEventSource.CLOSED);
    expect(vi.getTimerCount()).toBe(1);
    stop();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
