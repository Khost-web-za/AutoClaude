import { describe, expect, it } from 'vitest';
import { describeEvent } from '@/sessions/session-event-text';

describe('describeEvent', () => {
  it('shows a cleared conversation for SessionStart with source clear', () => {
    expect(describeEvent('hook', { event: 'SessionStart', source: 'clear' })).toEqual({ text: 'Conversation cleared', tone: 'default' });
  });

  it('keeps the plain text for other SessionStart sources', () => {
    expect(describeEvent('hook', { event: 'SessionStart', source: 'startup' })).toEqual({ text: 'Claude session started', tone: 'default' });
    expect(describeEvent('hook', { event: 'SessionStart' })).toEqual({ text: 'Claude session started', tone: 'default' });
  });

  it('describes workspace_sync ok with the summary', () => {
    expect(describeEvent('workspace_sync', { status: 'ok', summary: 'fast-forwarded 2 commits', source: 'startup' })).toEqual({
      text: 'Synced with the remote: fast-forwarded 2 commits',
      tone: 'default',
    });
  });

  it('describes workspace_sync ok without a summary', () => {
    expect(describeEvent('workspace_sync', { status: 'ok', source: 'startup' })).toEqual({ text: 'Synced with the remote', tone: 'default' });
  });

  it('flags a failed workspace_sync as a problem', () => {
    expect(describeEvent('workspace_sync', { status: 'failed', summary: 'rebase conflict', source: 'resume' })).toEqual({
      text: 'Sync failed: rebase conflict',
      tone: 'problem',
    });
  });

  it('describes a skipped workspace_sync', () => {
    expect(describeEvent('workspace_sync', { status: 'skipped', summary: 'no upstream', source: 'startup' })).toEqual({
      text: 'Sync skipped: no upstream',
      tone: 'default',
    });
  });

  it('clips a long sync summary', () => {
    const { text } = describeEvent('workspace_sync', { status: 'failed', summary: 'x'.repeat(1000), source: 'startup' });
    expect(text.length).toBeLessThanOrEqual(300);
    expect(text.endsWith('…')).toBe(true);
  });

  it('labels a live-only workspace_sync', () => {
    expect(describeEvent('workspace_sync', null)).toEqual({ text: 'Workspace sync', tone: 'default' });
  });
});
