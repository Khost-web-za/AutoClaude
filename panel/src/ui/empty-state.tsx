import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** Nothing-here-yet placeholder: icon, title, optional description and action. No card around it. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-20 text-center">
      <Icon aria-hidden className="size-8 text-text-subtle" />
      <h2 className="text-lg font-bold text-white">{title}</h2>
      {description ? <p className="max-w-md text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
