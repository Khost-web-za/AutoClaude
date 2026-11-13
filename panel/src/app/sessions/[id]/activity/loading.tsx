import { ListSkeleton } from '@/ui/page-skeleton';

export default function SessionActivityLoading() {
  return (
    <div aria-busy="true" className="max-w-4xl">
      <ListSkeleton rows={8} />
    </div>
  );
}
