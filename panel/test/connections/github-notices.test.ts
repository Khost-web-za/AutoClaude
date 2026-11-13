import { describe, expect, it } from 'vitest';
import { githubCallbackNotice } from '@/connections/github-notices';

describe('githubCallbackNotice', () => {
  it('maps each callback redirect to a notice', () => {
    expect(githubCallbackNotice({ connected: '1' })).toMatchObject({ tone: 'success' });
    expect(githubCallbackNotice({ installed: '1' })).toMatchObject({ tone: 'success' });
    expect(githubCallbackNotice({ authorized: '1' })).toMatchObject({ tone: 'success' });
    expect(githubCallbackNotice({ error: 'oauth_denied' })).toMatchObject({ tone: 'warning' });
    expect(githubCallbackNotice({ error: 'authorize_failed' })).toMatchObject({ tone: 'danger' });
  });

  it('ignores anything else, and never echoes the query back', () => {
    expect(githubCallbackNotice({})).toBeNull();
    expect(githubCallbackNotice({ page: '2' })).toBeNull();
    expect(githubCallbackNotice({ error: '<script>' })).toBeNull();
    expect(githubCallbackNotice({ connected: ['1', '1'] })).toMatchObject({ tone: 'success' });
  });
});
