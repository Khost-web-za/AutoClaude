import { ListSkeleton } from '@/ui/page-skeleton';

export default function RepoTabLoading() {
  return (
    <div aria-busy="true" className="max-w-4xl">
      <ListSkeleton rows={6} />
    </div>
  );
}
