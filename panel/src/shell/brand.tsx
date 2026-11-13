import Link from 'next/link';

/** Logo mark, "ClaudeCloud" and "PANEL" in mono; links home. */
export function Brand() {
  return (
    <Link
      href="/"
      className="flex items-center gap-3 rounded-xl px-1 focus-visible:outline-2 focus-visible:outline-focus"
    >
      <span
        aria-hidden
        className="grid size-8 place-items-center rounded-lg bg-accent text-sm font-bold text-on-accent"
      >
        C
      </span>
      <span className="flex flex-col leading-tight">
        <span className="font-bold text-white">ClaudeCloud</span>
        <span className="font-mono text-[10px] tracking-widest text-text-subtle uppercase">
          Panel
        </span>
      </span>
    </Link>
  );
}
