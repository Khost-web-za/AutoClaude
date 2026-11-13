import { NextResponse, type NextRequest } from 'next/server';
import { ACCESS_JWT_HEADER } from '@/auth/access-jwt';
import { resolveOwner } from '@/auth/owner-check';

/** Blocks before anything renders or streams. Pages and actions still call requireOwner(). */
export async function proxy(request: NextRequest) {
  const owner = await resolveOwner(request.headers.get(ACCESS_JWT_HEADER));
  if (owner) return NextResponse.next();
  return new NextResponse('Forbidden', {
    status: 403,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

export const config = {
  matcher: ['/((?!_next/|favicon\\.ico|api/health).*)'],
};
