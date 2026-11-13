import 'server-only';
import { notFound } from 'next/navigation';
import { requireOwner } from '@/auth/require-owner';
import { getSessionView, type SessionView } from './session-detail';

export type SessionRouteParams = { params: Promise<{ id: string }> };

/** The session a detail page (or its layout) is about, after the owner check; unknown or deleted is a 404. */
export async function loadSessionForPage(params: SessionRouteParams['params']): Promise<SessionView> {
  await requireOwner();
  const { id } = await params;
  const session = await getSessionView(id);
  if (!session) notFound();
  return session;
}
