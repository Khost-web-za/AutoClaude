import { stripAnsi } from '@/claude/ansi';
import { instantToWallTime, wallTimeToInstant } from '@/time/zoned-time';

export type ScreenRead = {
  limited: boolean;
  resetsAt: Date | null;
  blocking: 'permission' | 'question' | null;
  promptEmpty: boolean;
};

const VISIBLE_LINES = 15;
const DAY_MS = 24 * 60 * 60_000;

const DIVIDER = /^\s*[─━]{8,}\s*$/;
const LIMIT = /limit reached|hit your (?:usage |session )?limit|usage limit/i;
const RESET = /resets?(?: at)?\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))(?:\s*\(([^)]+)\))?/i;
const PERMISSION = /Do you want to|❯\s*1\.\s*Yes/;
const NUMBERED_MENU = /^\s*(?:❯\s*)?\d+\.\s+\S/m;
const RATE_LIMIT_MENU = /wait for limit to reset|upgrade your plan|extra usage/i;
const EMPTY_INPUT = /^\s*(?:[│|]\s*)?>\s*(?:[│|]\s*)?$/;

/** The next time after `now` that the clocks in `timeZone` read `clock` (`3pm`, `3:30 pm`). */
function nextResetAfter(clock: string, timeZone: string, now: Date): Date | null {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i.exec(clock);
  if (!match) return null;
  const hour12 = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (hour12 < 1 || hour12 > 12 || minute > 59) return null;
  const hour = (hour12 % 12) + (match[3]!.toLowerCase() === 'pm' ? 12 : 0);
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const today = instantToWallTime(now, timeZone).slice(0, 10);
  let reset = wallTimeToInstant(`${today}T${time}`, timeZone);
  if (reset.getTime() <= now.getTime()) {
    const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
    reset = wallTimeToInstant(`${tomorrow}T${time}`, timeZone);
  }
  return reset;
}

function resetTime(text: string, containerTimeZone: string, now: Date): Date | null {
  const match = RESET.exec(text);
  if (!match) return null;
  const named = match[2]?.trim();
  if (named) {
    try {
      return nextResetAfter(match[1]!, named, now);
    } catch {
      // Not an IANA zone (e.g. an abbreviation): fall through to the container zone.
    }
  }
  return nextResetAfter(match[1]!, containerTimeZone, now);
}

/** What Claude Code's visible screen says: usage limit and reset, anything blocking input, empty prompt. */
export function readScreen(pane: string, now: Date, containerTimeZone = 'UTC'): ScreenRead {
  const lines = stripAnsi(pane).replace(/\r/g, '').split('\n');
  const dividers = lines.flatMap((line, index) => (DIVIDER.test(line) ? [index] : []));
  const lastDivider = dividers.at(-1) ?? -1;

  // Only what is below the last prompt box divider and on the last lines counts; older output has scrolled.
  const visible = lines.slice(Math.max(lastDivider + 1, lines.length - VISIBLE_LINES)).join('\n');
  const limited = LIMIT.test(visible);

  let blocking: ScreenRead['blocking'] = null;
  if (PERMISSION.test(visible)) blocking = 'permission';
  else if (NUMBERED_MENU.test(visible) && !RATE_LIMIT_MENU.test(visible)) blocking = 'question';

  // The input line sits between the last two dividers (above the one the footer hangs from).
  const boxTop = dividers.at(-2);
  const input = boxTop === undefined ? undefined : lines.slice(boxTop + 1, lastDivider).find((line) => /^\s*(?:[│|]\s*)?>/.test(line));
  const promptEmpty = input !== undefined && EMPTY_INPUT.test(input);

  return { limited, resetsAt: limited ? resetTime(visible, containerTimeZone, now) : null, blocking, promptEmpty };
}
