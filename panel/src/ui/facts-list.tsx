import type { ReactNode } from 'react';

export type Fact = { label: string; value: ReactNode };

/** Label / value rows. Stacks on phones, two columns from sm up. */
export function FactsList({ facts }: { facts: readonly Fact[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[9rem_1fr] sm:gap-y-3">
      {facts.map((fact) => (
        <div key={fact.label} className="contents">
          <dt className="text-text-subtle">{fact.label}</dt>
          <dd className="mb-3 min-w-0 break-words text-surface-foreground sm:mb-0">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
