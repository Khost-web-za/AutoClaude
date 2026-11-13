import { Bot, FileText, Sparkles } from 'lucide-react';
import type { Profile } from './profile-catalog';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** What a profile brings: CLAUDE.md · N skills · N agents (only the parts it has). */
export function ProfileContents({ profile }: { profile: Pick<Profile, 'hasClaudeMd' | 'skills' | 'agents'> }) {
  const parts = [
    profile.hasClaudeMd ? { icon: FileText, label: 'CLAUDE.md' } : null,
    profile.skills.length > 0 ? { icon: Sparkles, label: plural(profile.skills.length, 'skill') } : null,
    profile.agents.length > 0 ? { icon: Bot, label: plural(profile.agents.length, 'agent') } : null,
  ].filter((part) => part !== null);
  return (
    <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-subtle">
      {parts.map(({ icon: Icon, label }) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <Icon aria-hidden className="size-3.5" />
          {label}
        </span>
      ))}
    </span>
  );
}
