export const dynamic = 'force-dynamic';

/** Unauthenticated liveness probe for Coolify. Returns nothing but "ok". */
export function GET() {
  return new Response('ok', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
