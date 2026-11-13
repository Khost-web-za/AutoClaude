import { describe, expect, it } from 'vitest';
import { describeConnections } from '@/connections/connection-health';

describe('describeConnections', () => {
  it('is green once Claude is connected and the App is installed somewhere', () => {
    expect(describeConnections({ claude: 'connected', installations: 2 })).toEqual({
      tone: 'ok',
      label: 'Connected',
      href: '/connections',
    });
  });

  it('names what is missing and links to the tab that fixes it', () => {
    expect(describeConnections({ claude: 'missing', installations: 1 })).toEqual({
      tone: 'warning',
      label: 'Claude not connected',
      href: '/connections/claude',
    });
    expect(describeConnections({ claude: 'expired', installations: 1 })).toMatchObject({
      label: 'Claude login expired',
      href: '/connections/claude',
    });
    expect(describeConnections({ claude: 'connected', installations: 0 })).toEqual({
      tone: 'warning',
      label: 'GitHub not installed',
      href: '/connections/github',
    });
    expect(describeConnections({ claude: 'missing', installations: 0 })).toEqual({
      tone: 'warning',
      label: 'Claude and GitHub missing',
      href: '/connections/claude',
    });
  });

  it('never claims green when a check could not run', () => {
    expect(describeConnections({ claude: 'unknown', installations: 1 })).toMatchObject({
      tone: 'warning',
      label: 'Claude status unknown',
    });
    expect(describeConnections({ claude: 'connected', installations: null })).toMatchObject({
      tone: 'warning',
      label: 'GitHub status unknown',
      href: '/connections/github',
    });
  });
});
