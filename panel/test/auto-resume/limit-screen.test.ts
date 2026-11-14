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
    expect(readScreen('Claude usage limit reached', NOW)).toMatchObject({ limited: true, resetsAt: null });
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
  });

  it('empty prompt', () => {
    const read = readScreen(fixture('empty-prompt'), NOW);
    expect(read).toMatchObject({ limited: false, blocking: null, promptEmpty: true });
  });

  it('a prompt with typed text is not empty', () => {
    const pane = ['────────────', '> half a thought', '────────────', '  ? for shortcuts'].join('\n');
    expect(readScreen(pane, NOW).promptEmpty).toBe(false);
  });

  it('strips ANSI before reading', () => {
    const pane = '\u001b[31m5-hour limit reached\u001b[0m \u001b[2m∙ resets 3pm\u001b[0m';
    expect(readScreen(pane, NOW)).toMatchObject({ limited: true, resetsAt: new Date('2026-11-14T15:00:00Z') });
  });

  it('only reads the last 15 lines', () => {
    const pane = ['5-hour limit reached ∙ resets 3pm', ...Array.from({ length: 15 }, (_, i) => `line ${i}`)].join('\n');
    expect(readScreen(pane, NOW).limited).toBe(false);
  });
});
