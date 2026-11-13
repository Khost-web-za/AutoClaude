import type { NextRequest } from 'next/server';
import { requireOwner } from '@/auth/require-owner';
import { handleManifestStart } from '@/github/callback-handlers';
import { sharedGithubDeps } from '@/github/github-deps';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const owner = await requireOwner();
  return handleManifestStart(
    {
      organization: request.nextUrl.searchParams.get('organization')?.trim() || null,
      ownerHint: owner.email.split('@')[0] ?? 'owner',
    },
    sharedGithubDeps(),
  );
}
