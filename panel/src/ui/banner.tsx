import { CircleCheck, OctagonAlert, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

const TONE = {
  danger: { icon: OctagonAlert, style: 'bg-danger/10 text-danger', role: 'alert' },
  warning: { icon: TriangleAlert, style: 'bg-warning/10 text-warning', role: 'status' },
  success: { icon: CircleCheck, style: 'bg-accent-soft text-accent-text', role: 'status' },
} as const;

/** A full-width notice (host disk low, Claude disconnected, a finished GitHub step). `action` is usually a link or button. */
export function Banner({
  tone,
  title,
  action,
}: {
  tone: keyof typeof TONE;
  title: string;
  action?: ReactNode;
}) {
  const { icon: Icon, style, role } = TONE[tone];
  return (
    <div
      role={role}
      className={`flex flex-col gap-3 rounded-xl px-4 py-3 text-sm font-semibold sm:flex-row sm:items-center sm:justify-between ${style}`}
    >
      <span className="flex items-center gap-3">
        <Icon aria-hidden className="size-4 shrink-0" />
        {title}
      </span>
      {action ? <span className="shrink-0">{action}</span> : null}
    </div>
  );
}
