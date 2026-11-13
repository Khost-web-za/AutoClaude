import { redirect } from 'next/navigation';
import { requireOwner } from '@/auth/require-owner';

export default async function ConnectionsPage() {
  await requireOwner();
  redirect('/connections/claude');
}
