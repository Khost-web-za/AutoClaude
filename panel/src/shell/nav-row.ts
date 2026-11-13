/** One sidebar row: 40 px tall, rounded fill. */
export const NAV_ROW_CLASS =
  'flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-focus';

export const NAV_ROW_IDLE_CLASS = 'text-default-foreground hover:bg-surface-secondary';

/** Active row: accent tint plus a 2 px inset accent bar on the left edge. */
export const NAV_ROW_ACTIVE_CLASS =
  'bg-accent-soft text-accent-text shadow-[inset_2px_0_0_var(--accent)]';
