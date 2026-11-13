import { createHash, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db as sharedDb, type Db } from '@/db/client';
import { sessions } from '@/db/schema';

export type Session = typeof sessions.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DUMMY_HASH = hashSessionSecret('no-such-session');

export function hashSessionSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

function hashesMatch(expectedHex: string, actualHex: string): boolean {
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = Buffer.from(actualHex, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** The live (not deleted) session when `secret` is its secret, otherwise null. Constant-time compare. */
export async function verifySession(
  id: string,
  secret: string,
  db: Db = sharedDb,
): Promise<Session | null> {
  const [session] = UUID.test(id)
    ? await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.id, id.toLowerCase()), isNull(sessions.deletedAt)))
    : [];
  const matches = hashesMatch(session?.secretHash ?? DUMMY_HASH, hashSessionSecret(secret));
  return session && matches ? session : null;
}
