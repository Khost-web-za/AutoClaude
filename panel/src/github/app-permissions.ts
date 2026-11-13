/** The only permissions the panel ever asks for, on the App and on every session token it mints. */
export const GITHUB_APP_PERMISSIONS = {
  contents: 'write',
  pull_requests: 'write',
  metadata: 'read',
  workflows: 'write',
} as const;

export type GrantedPermissions = Record<string, string>;

/** Read-only access for listing a repo's branches: enough there, and less than sessions get. */
export const GITHUB_READ_PERMISSIONS = { contents: 'read', metadata: 'read' } as const;

const LEVEL: Record<string, number> = { read: 1, write: 2, admin: 3 };

/**
 * The permissions sessions need that `granted` (from GET /app or an installation) lacks, as
 * "contents: write" labels. Empty when everything is there.
 */
export function missingPermissions(granted: GrantedPermissions): string[] {
  return Object.entries(GITHUB_APP_PERMISSIONS)
    .filter(([name, level]) => (LEVEL[granted[name] ?? ''] ?? 0) < (LEVEL[level] ?? 0))
    .map(([name, level]) => `${name}: ${level}`);
}

export class MissingPermissionsError extends Error {
  override name = 'MissingPermissionsError';
  constructor(readonly missing: string[]) {
    super(`The GitHub App is missing permissions: ${missing.join(', ')}`);
  }
}
