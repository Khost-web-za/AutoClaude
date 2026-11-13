import type { NextRequest } from 'next/server';
import { requireOwner } from '@/auth/require-owner';
import { handleOAuthCallback } from '@/github/callback-handlers';
import { sharedGithubDeps } from '@/github/github-deps';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  await requireOwner();
  return handleOAuthCallback(request, sharedGithubDeps());
}
