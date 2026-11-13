import { requireOwner } from '@/auth/require-owner';
import { handleOAuthStart } from '@/github/callback-handlers';
import { sharedGithubDeps } from '@/github/github-deps';

export const dynamic = 'force-dynamic';

export async function GET() {
  await requireOwner();
  return handleOAuthStart(sharedGithubDeps());
}
