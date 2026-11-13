import { describe, expect, it } from 'vitest';
import { formatSse, SSE_HEARTBEAT, SSE_RETRY_LINE } from '@/live/sse-format';

describe('formatSse', () => {
  it('writes the kind as the event name and the event as one line of json', () => {
    const out = formatSse({ kind: 'session', sessionId: 'abc', status: 'working', detail: 'line1\nline2' });
    expect(out).toBe(
      'event: session\ndata: {"kind":"session","sessionId":"abc","status":"working","detail":"line1\\nline2"}\n\n',
    );
  });

  it('formats host events with null stats', () => {
    expect(formatSse({ kind: 'host', stats: null })).toBe('event: host\ndata: {"kind":"host","stats":null}\n\n');
  });

  it('exposes the retry and heartbeat frames', () => {
    expect(SSE_RETRY_LINE).toBe('retry: 3000\n\n');
    expect(SSE_HEARTBEAT).toBe(': heartbeat\n\n');
  });
});
