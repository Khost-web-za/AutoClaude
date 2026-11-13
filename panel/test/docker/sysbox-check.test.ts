import { beforeEach, describe, expect, it, vi } from 'vitest';

const info = vi.hoisted(() => vi.fn());
vi.mock('@/docker/docker-client', () => ({ docker: { info } }));

import { hasSysbox, resetSysboxCache } from '@/docker/sysbox-check';

beforeEach(() => {
  info.mockReset();
  resetSysboxCache();
});

describe('hasSysbox', () => {
  it('reports the runtime and caches for 5 minutes', async () => {
    info.mockResolvedValue({ Runtimes: { 'sysbox-runc': {}, runc: {} } });
    expect(await hasSysbox(1_000)).toBe(true);
    info.mockResolvedValue({ Runtimes: { runc: {} } });
    expect(await hasSysbox(1_000 + 299_000)).toBe(true);
    expect(info).toHaveBeenCalledTimes(1);
    expect(await hasSysbox(1_000 + 300_000)).toBe(false);
    expect(info).toHaveBeenCalledTimes(2);
  });
});
