import { stripAnsi } from '@/claude/ansi';
import { nextWallClock } from '@/time/zoned-time';

export type ScreenRead = {
  /** Claude's limit notice is the latest thing in the transcript. */
  limited: boolean;
  resetsAt: Date | null;
  blocking: 'permission' | 'question' | null;
  /** The live prompt box is on screen and empty. */
  promptEmpty: boolean;
  /** The live prompt box holds text the user has not sent. */
  promptDraft: boolean;
  /** The usage-limit menu ("Stop and wait for limit to reset" …) is drawn in place of the prompt box. */
  limitMenu: boolean;
};

const SCREENFUL_LINES = 40;
const DIALOG_FALLBACK_LINES = 15;

const DIVIDER = /^\s*[╭╰]?[─━]{8,}[╮╯]?\s*$/;
const INPUT_LINE = /^\s*(?:[│|]\s*)?>/;
const SUBMITTED_PROMPT = /^\s*>\s+\S/;
/**
 * Claude Code's limit notice, at the start of its own line (optionally as a `⎿` notice):
 * "5-hour limit reached ∙ resets 3pm", "Claude usage limit reached. Your limit will reset at …",
 * "You've hit your limit · resets 3pm". Prose and tool output that merely mention a limit do not start so.
 */
const LIMIT_NOTICE =
  /^\s*(?:⎿\s*)?(?:(?:(?:claude|5-hour|weekly|session|usage|opus|sonnet)\s+)*limit reached\b|you(?:'|’)ve hit your\b.*\blimit\b)/i;
const RESET_CLAUSE = /\bresets?\b/i;
/** The start of another transcript entry (assistant reply, tool call/output, spinner) after the notice. */
const NEW_ENTRY = /^\s*[⏺●⎿✻✶✳✢✽*·]/;
const RESET = /resets?(?: at)?\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))(?:\s*\(([^)]+)\))?/i;
const PERMISSION = /Do you want to|❯\s*1\.\s*Yes/;
const NUMBERED_MENU = /^\s*❯\s*\d+\.\s+\S/m;
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
  return nextWallClock(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, timeZone, now);
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

/**
 * The limit notice and its reset clause when the notice is the latest thing in `transcript`: the reset clause
 * (or the limit menu) on its line or the next, and after it only its own continuation lines (no new reply,
 * tool output or spinner) up to the box or menu. Null otherwise.
 */
function latestLimitNotice(transcript: string[], limitMenu: boolean): string | null {
  const index = transcript.findLastIndex((line) => LIMIT_NOTICE.test(line));
  if (index < 0) return null;
  const end = transcript.findIndex((line, i) => i > index && DIVIDER.test(line));
  const after = transcript.slice(index + 1, end < 0 ? undefined : end);
  if (after.some((line) => NEW_ENTRY.test(line))) return null;
  const notice = [transcript[index]!, after[0] ?? ''].join('\n');
  return RESET_CLAUSE.test(notice) || limitMenu ? notice : null;
}

/**
 * What Claude Code's visible screen says: usage limit and reset, anything blocking input, the prompt box.
 *
 * Layout, top to bottom: transcript (user `> prompt`, assistant lines, `⎿` notices), then either the live
 * prompt box (divider, input line, divider) plus footer, or a dialog/menu drawn in place of the box.
 */
export function readScreen(pane: string, now: Date, containerTimeZone = 'UTC'): ScreenRead {
  const lines = stripAnsi(pane).replace(/\r/g, '').split('\n');
  const dividers = lines.flatMap((line, index) => (DIVIDER.test(line) ? [index] : []));
  const boxTop = dividers.at(-2);
  const boxBottom = dividers.at(-1);
  const hasBox =
    boxTop !== undefined && boxBottom !== undefined && lines.slice(boxTop + 1, boxBottom).some((line) => INPUT_LINE.test(line));

  // Transcript: the last screenful above the live box. Only what follows the last submitted prompt counts,
  // so a limit message from an earlier turn that has scrolled up never retriggers.
  const end = hasBox ? boxTop : lines.length;
  const window = lines.slice(Math.max(0, end - SCREENFUL_LINES), end);
  const lastPrompt = window.findLastIndex((line) => SUBMITTED_PROMPT.test(line));

  // A dialog exists only while the prompt box is gone; it starts at the last divider when there is one.
  let blocking: ScreenRead['blocking'] = null;
  let limitMenu = false;
  if (!hasBox) {
    let start = lines.length - DIALOG_FALLBACK_LINES;
    if (boxBottom !== undefined) {
      const after = lines.slice(boxBottom + 1);
      start = after.some((line) => line.trim()) || boxTop === undefined ? boxBottom + 1 : boxTop + 1;
    }
    const dialog = lines.slice(Math.max(0, start)).join('\n');
    const menu = NUMBERED_MENU.test(dialog);
    limitMenu = menu && RATE_LIMIT_MENU.test(dialog);
    if (PERMISSION.test(dialog)) blocking = 'permission';
    else if (menu && !limitMenu) blocking = 'question';
  }

  const notice = latestLimitNotice(window.slice(lastPrompt + 1), limitMenu);
  const input = hasBox ? lines.slice(boxTop + 1, boxBottom).find((line) => INPUT_LINE.test(line)) : undefined;
  const promptEmpty = input !== undefined && EMPTY_INPUT.test(input);

  return {
    limited: notice !== null,
    resetsAt: notice !== null ? resetTime(notice, containerTimeZone, now) : null,
    blocking,
    promptEmpty,
    promptDraft: input !== undefined && !promptEmpty,
    limitMenu,
  };
}
