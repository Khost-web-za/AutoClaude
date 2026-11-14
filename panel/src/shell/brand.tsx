import Image from 'next/image';
import Link from 'next/link';
import brandMark from './brand-mark.png';

/** Logo mark, "AutoClaude" and "PANEL" in mono; links home. */
export function Brand() {
  return (
    <Link
      href="/"
      className="flex items-center gap-3 rounded-xl px-1 focus-visible:outline-2 focus-visible:outline-focus"
    >
      {/* Pre-sized and already transparent, so it skips the optimizer. */}
      <Image src={brandMark} alt="" aria-hidden unoptimized priority className="h-8 w-auto shrink-0" />
      <span className="flex flex-col leading-tight">
        <span className="font-bold text-white">
          Auto<span className="text-accent-text">Claude</span>
        </span>
        <span className="font-mono text-[10px] tracking-widest text-text-subtle uppercase">Panel</span>
      </span>
    </Link>
  );
}
