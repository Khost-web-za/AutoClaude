import 'server-only';
import { headers } from 'next/headers';
import { forbidden } from 'next/navigation';
import { ACCESS_JWT_HEADER } from '@/auth/access-jwt';
import { resolveOwner, type Owner } from '@/auth/owner-check';

/** Call first in every page, server action, route handler and the SSE stream. */
export async function requireOwner(): Promise<Owner> {
  const requestHeaders = await headers();
  const owner = await resolveOwner(requestHeaders.get(ACCESS_JWT_HEADER));
  if (!owner) forbidden();
  return owner;
}
