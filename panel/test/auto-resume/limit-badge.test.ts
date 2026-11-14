import { describe, expect, it } from 'vitest';
import { limitLabel } from '@/auto-resume/limit-badge';

const resetsAt = new Date('2026-11-14T02:01:00Z');

describe('limitLabel', () => {
  it('shows nothing when there is no limit', () => {
    expect(limitLabel('none', null, null, 'UTC')).toBeNull();
  });

  it('shows the resume time in the settings zone', () => {
    expect(limitLabel('limited', resetsAt, null, 'UTC')).toBe('Limit hit · resumes 02:01');
    expect(limitLabel('limited', resetsAt, null, 'Europe/Berlin')).toBe('Limit hit · resumes 03:01');
  });

  it('omits the time when the reset is unknown', () => {
    expect(limitLabel('limited', null, null, 'UTC')).toBe('Limit hit');
  });

  it('says resuming while an attempt runs', () => {
    expect(limitLabel('resuming', resetsAt, null, 'UTC')).toBe('Resuming…');
  });

  it('shows the failure detail', () => {
    expect(limitLabel('failed', null, 'Resume failed: gave up', 'UTC')).toBe('Resume failed: gave up');
    expect(limitLabel('failed', null, null, 'UTC')).toBe('Resume failed');
  });
});
