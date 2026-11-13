import { describe, expect, it } from 'vitest';
import { extractLoginUrl, hasCodePrompt, stripAnsi, validateLoginCode } from '@/claude/login-helper';

const URL_LINE =
  'https://claude.com/cai/oauth/authorize?code=true&client_id=abc&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=user%3Ainference&code_challenge=xyz&code_challenge_method=S256&state=st';

const ESC = '\u001b';

const transcript = (urlPart: string) =>
  `\u001b[2J\u001b[HOpening browser to sign in…\r\nIf the browser didn't open, visit: \u001b[4m${urlPart}\u001b[24m\r\nPaste code here if prompted > `;

describe('login output parsing', () => {
  it('strips ANSI codes', () => {
    expect(stripAnsi('\u001b[31mred\u001b[0m')).toBe('red');
  });

  it('extracts the URL from a transcript with ANSI codes', () => {
    expect(extractLoginUrl(transcript(URL_LINE))).toBe(URL_LINE);
  });

  it('is lenient on host and path (claude.ai, no /cai)', () => {
    const url = 'https://claude.ai/oauth/authorize?client_id=1&state=2';
    expect(extractLoginUrl(`visit: ${url}\r\n`)).toBe(url);
  });

  it('rejoins a URL wrapped by the TTY', () => {
    const wrapped = `${URL_LINE.slice(0, 80)}\r\n${URL_LINE.slice(80)}`;
    expect(extractLoginUrl(transcript(wrapped))).toBe(URL_LINE);
  });

  it('does not swallow the following prompt line into the URL', () => {
    expect(extractLoginUrl(transcript(URL_LINE))).not.toContain('Paste');
  });

  it('keeps the visible URL when it is wrapped in an OSC 8 hyperlink', () => {
    const ST = `${ESC}\\`;
    const osc = `${ESC}]8;;${URL_LINE}${ST}${URL_LINE}${ESC}]8;;${ST}`;
    expect(extractLoginUrl(transcript(osc))).toBe(URL_LINE);
    expect(stripAnsi(osc)).toBe(URL_LINE);
  });

  it('returns null before the URL shows up', () => {
    expect(extractLoginUrl('Opening browser to sign in…\r\n')).toBeNull();
    expect(extractLoginUrl('https://claude.com/cai/oauth/authorize')).toBeNull();
  });

  it('detects the code prompt', () => {
    expect(hasCodePrompt(transcript(URL_LINE))).toBe(true);
    expect(hasCodePrompt('Opening browser')).toBe(false);
  });
});

describe('validateLoginCode', () => {
  it('trims and accepts a normal code', () => {
    expect(validateLoginCode('  abc123#def-_  ')).toBe('abc123#def-_');
  });

  it('rejects empty, oversized and control-character codes', () => {
    expect(validateLoginCode('   ')).toBeNull();
    expect(validateLoginCode('x'.repeat(600))).toBeNull();
    expect(validateLoginCode('abc\r\nrm -rf')).toBeNull();
    expect(validateLoginCode('abc\u0000')).toBeNull();
  });
});
