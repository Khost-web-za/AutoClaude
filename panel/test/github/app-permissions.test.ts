import { describe, expect, it } from 'vitest';
import { GITHUB_APP_PERMISSIONS, missingPermissions } from '@/github/app-permissions';

describe('missingPermissions', () => {
  it('is empty when every needed permission is granted, extra or higher levels included', () => {
    expect(missingPermissions({ ...GITHUB_APP_PERMISSIONS, issues: 'write' })).toEqual([]);
    expect(missingPermissions({ ...GITHUB_APP_PERMISSIONS, metadata: 'write' })).toEqual([]);
  });

  it('lists what is absent or granted below the needed level', () => {
    expect(missingPermissions({ contents: 'read', metadata: 'read', pull_requests: 'write' })).toEqual([
      'contents: write',
      'workflows: write',
    ]);
    expect(missingPermissions({})).toEqual([
      'contents: write',
      'pull_requests: write',
      'metadata: read',
      'workflows: write',
    ]);
  });
});
