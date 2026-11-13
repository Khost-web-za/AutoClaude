import type { ReactNode } from 'react';

/** The small mono, uppercase heading above a group of fields or facts. */
export function SectionLabel({
  children,
  as: Tag = 'h2',
  className = '',
}: {
  children: ReactNode;
  as?: 'h2' | 'h3';
  className?: string;
}) {
  return (
    <Tag className={`font-mono text-[11px] font-medium tracking-[0.12em] text-text-subtle uppercase ${className}`}>
      {children}
    </Tag>
  );
}
