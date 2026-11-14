import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readScreen } from '@/auto-resume/limit-screen';

// Fixtures start with a `# synthetic` header line; drop it so only the pane remains.
const fixture = (name: string) =>
  readFileSync(join(__dirname, '../fixtures/limit-screens', `${name}.txt`), 'utf8').replace(/^# synthetic[^\n]*\n/, '');

const NOW = new Date('2026-11-14T10:00:00Z');

describe('readScreen', () => {
  it('detects the 5-hour limit with a reset time', () => {
    const read = readScreen(fixture('limit-5-hour'), NOW);
    expect(read.limited).toBe(true);
    expect(read.resetsAt).toEqual(new Date('2026-11-14T15:00:00Z'));
    expect(read.blocking).toBeNull();
  });

  it('parses a reset in a named zone', () => {
    const read = readScreen(fixture('limit-named-zone'), NOW, 'UTC');
    expect(read.resetsAt).toEqual(new Date('2026-11-14T14:30:00Z')); // 15:30 CET
  });

  it('uses the container zone when the message names none', () => {
    const read = readScreen(fixture('limit-5-hour'), NOW, 'Asia/Tokyo');
    expect(read.resetsAt).toEqual(new Date('2026-11-15T06:00:00Z')); // 15:00 JST today (06:00Z) has passed
  });

  it('rolls an earlier wall time to tomorrow', () => {
    const read = readScreen('  ⎿  5-hour limit reached ∙ resets 9am', NOW);
    expect(read.resetsAt).toEqual(new Date('2026-11-15T09:00:00Z'));
  });

  it('reads 12am and 12pm as midnight and noon', () => {
    expect(readScreen('usage limit reached, resets 12am', NOW).resetsAt).toEqual(new Date('2026-11-15T00:00:00Z'));
    expect(readScreen('usage limit reached, resets 12pm', NOW).resetsAt).toEqual(new Date('2026-11-14T12:00:00Z'));
  });

  it('is limited without a reset time when none can be read', () => {
    expect(readScreen('  ⎿  Weekly limit reached ∙ resets Monday', NOW)).toMatchObject({ limited: true, resetsAt: null });
  });

  it('reads the older "Your limit will reset at" wording', () => {
    const pane = 'Claude usage limit reached. Your limit will reset at 3pm (Europe/Berlin).';
    expect(readScreen(pane, NOW)).toMatchObject({ limited: true, resetsAt: new Date('2026-11-14T14:00:00Z') });
  });

  it('reads "You\'ve hit your limit"', () => {
    expect(readScreen("  ⎿  You've hit your limit · resets 3pm", NOW)).toMatchObject({
      limited: true,
      resetsAt: new Date('2026-11-14T15:00:00Z'),
    });
  });

  it('needs the reset clause (or the limit menu) with the notice', () => {
    expect(readScreen('Claude usage limit reached', NOW).limited).toBe(false);
  });

  it('accepts a reset clause on the line after the notice, and a continuation line', () => {
    const pane = ['> go', '', '  ⎿  5-hour limit reached', '     resets 3pm', '     /upgrade to increase your usage limit.'].join('\n');
    expect(readScreen(pane, NOW)).toMatchObject({ limited: true, resetsAt: new Date('2026-11-14T15:00:00Z') });
  });

  it('ignores an assistant reply that talks about usage limits', () => {
    expect(readScreen(fixture('assistant-mentions-usage-limit'), NOW)).toMatchObject({ limited: false, resetsAt: null });
  });

  it('ignores tool output that mentions a rate or usage limit', () => {
    expect(readScreen(fixture('tool-output-rate-limit'), NOW)).toMatchObject({ limited: false, resetsAt: null });
  });

  it('ignores a notice that is not the latest thing in the transcript', () => {
    const pane = ['> go', '  ⎿  5-hour limit reached ∙ resets 3pm', '', '⏺ Carrying on with the refactor.'].join('\n');
    expect(readScreen(pane, NOW).limited).toBe(false);
  });

  it('ignores notice-like text inside a line', () => {
    expect(readScreen('  ⎿  Error: usage limit reached, resets 3pm', NOW).limited).toBe(false);
    expect(readScreen('  ⎿  Rate limit reached for requests, resets 3pm', NOW).limited).toBe(false);
  });

  it('ignores a limit line above a later prompt', () => {
    const read = readScreen(fixture('limit-scrolled-above-prompt'), NOW);
    expect(read.limited).toBe(false);
    expect(read.resetsAt).toBeNull();
    expect(read.promptEmpty).toBe(true);
  });

  it('flags a permission prompt', () => {
    const read = readScreen(fixture('permission-prompt'), NOW);
    expect(read.blocking).toBe('permission');
    expect(read.limited).toBe(false);
  });

  it('flags another numbered menu as a question', () => {
    const pane = ['────────────', ' Which approach?', ' ❯ 1. Rewrite it', '   2. Patch it'].join('\n');
    expect(readScreen(pane, NOW).blocking).toBe('question');
  });

  it('the rate-limit menu is not a blocking question', () => {
    const read = readScreen(fixture('limit-options-menu'), NOW);
    expect(read.limited).toBe(true);
    expect(read.blocking).toBeNull();
    expect(read.limitMenu).toBe(true);
  });

  it('a limit notice above the prompt box is not the limit menu', () => {
    expect(readScreen(fixture('limit-5-hour'), NOW).limitMenu).toBe(false);
    expect(readScreen(fixture('permission-prompt'), NOW).limitMenu).toBe(false);
  });

  it('empty prompt', () => {
    const read = readScreen(fixture('empty-prompt'), NOW);
    expect(read).toMatchObject({ limited: false, blocking: null, promptEmpty: true });
  });

  it('a prompt with typed text is not empty', () => {
    const pane = ['────────────', '> half a thought', '────────────', '  ? for shortcuts'].join('\n');
    expect(readScreen(pane, NOW)).toMatchObject({ promptEmpty: false, promptDraft: true });
  });

  it('an empty prompt holds no draft', () => {
    expect(readScreen(fixture('empty-prompt'), NOW).promptDraft).toBe(false);
  });

  it('strips ANSI before reading', () => {
    const pane = '\u001b[31m5-hour limit reached\u001b[0m \u001b[2m∙ resets 3pm\u001b[0m';
    expect(readScreen(pane, NOW)).toMatchObject({ limited: true, resetsAt: new Date('2026-11-14T15:00:00Z') });
  });

  it('only reads the last screenful', () => {
    const pane = ['5-hour limit reached ∙ resets 3pm', ...Array.from({ length: 40 }, (_, i) => `line ${i}`)].join('\n');
    expect(readScreen(pane, NOW).limited).toBe(false);
  });

  it('finds a limit above an empty prompt box when no later prompt was submitted', () => {
    const read = readScreen(fixture('limit-5-hour'), NOW);
    expect(read).toMatchObject({ limited: true, promptEmpty: true, blocking: null });
  });

  it('reads the rounded prompt box style', () => {
    expect(readScreen(fixture('limit-rounded-box'), NOW)).toMatchObject({ limited: true, promptEmpty: true });
  });

  it('a numbered list and "Do you want to" in prose above the prompt box are not blocking', () => {
    const pane = [
      '> plan it',
      '',
      '  Do you want to hear the options? Here they are:',
      '  1. Rewrite it',
      '  2. Patch it',
      '',
      '────────────',
      '> ',
      '────────────',
      '  ? for shortcuts',
    ].join('\n');
    expect(readScreen(pane, NOW)).toMatchObject({ blocking: null, promptEmpty: true });
  });
});
