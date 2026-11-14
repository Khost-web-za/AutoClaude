/** Human text for a runner event (docs/runner-contract.md). Client-safe; event data is already redacted. */

export type EventTone = 'default' | 'question' | 'problem';
export type EventText = { text: string; tone: EventTone };

const BOOT_STEPS: Record<string, string> = {
  docker: 'Docker in the session',
  clone: 'Cloning the repository',
  branch: 'Creating the working branch',
  config: 'Installing the config profiles',
  secrets: 'Loading the repository secrets',
  launch: 'Launching Claude',
};

const str = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);
const MAX_TEXT = 300;
const clip = (text: string) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text);

/** A pushed live event carries only its type; the details come with the next server render. */
const LIVE_ONLY: Record<string, string> = {
  boot_step: 'Boot progress',
  remote_control_url: 'Connected to Claude (Remote Control ready)',
  hook: 'Claude activity',
  workspace_sync: 'Workspace sync',
  claude_exited: 'Claude exited',
};

export function describeEvent(type: string, data: Record<string, unknown> | null): EventText {
  if (data === null) return { text: LIVE_ONLY[type] ?? type, tone: 'default' };
  const d = data;
  switch (type) {
    case 'boot_step': {
      const step = BOOT_STEPS[str(d.step) ?? ''] ?? `Boot step ${str(d.step) ?? ''}`.trim();
      if (d.status === 'failed') return { text: clip(`${step} failed${str(d.error) ? `: ${str(d.error)}` : ''}`), tone: 'problem' };
      if (d.status === 'done') return { text: `${step}: done`, tone: 'default' };
      return { text: `${step}…`, tone: 'default' };
    }
    case 'remote_control_url':
      return { text: 'Connected to Claude (Remote Control ready)', tone: 'default' };
    case 'hook':
      switch (d.event) {
        case 'SessionStart':
          if (d.source === 'clear') return { text: 'Conversation cleared', tone: 'default' };
          return { text: 'Claude session started', tone: 'default' };
        case 'UserPromptSubmit':
          return { text: 'You sent a message', tone: 'default' };
        case 'Notification':
          return { text: clip(str(d.message) ? `Asked: ${str(d.message)}` : 'Waiting for you'), tone: 'question' };
        case 'Stop':
          return { text: 'Claude finished its turn', tone: 'default' };
        default:
          return { text: `Hook ${str(d.event) ?? ''}`.trim(), tone: 'default' };
      }
    case 'workspace_sync': {
      const summary = str(d.summary);
      if (d.status === 'failed') return { text: clip(`Sync failed${summary ? `: ${summary}` : ''}`), tone: 'problem' };
      if (d.status === 'skipped') return { text: clip(`Sync skipped${summary ? `: ${summary}` : ''}`), tone: 'default' };
      return { text: clip(`Synced with the remote${summary ? `: ${summary}` : ''}`), tone: 'default' };
    }
    case 'claude_exited': {
      const code = typeof d.code === 'number' ? ` (code ${d.code})` : '';
      if (d.restarting === true) return { text: `Claude exited${code}; restarting`, tone: 'default' };
      return { text: `Claude exited${code}`, tone: d.fatal === true ? 'problem' : 'default' };
    }
    default:
      return { text: type, tone: 'default' };
  }
}
