import type { Profile } from './profile-catalog';
import { BASE_PROFILE } from './profile-names';

export type MergeClash = { kind: 'skill' | 'agent'; name: string; winner: string; losers: string[] };

export class UnknownProfileError extends Error {
  constructor(public readonly profileName: string) {
    super(`Unknown config profile: ${profileName}`);
    this.name = 'UnknownProfileError';
  }
}

/**
 * Merge order (base first, then the rest alphabetically) and the skill/agent name clashes it causes. Pure and
 * client-safe: New session shows the clash warning with it before Start.
 */
export function planMerge(selected: string[], catalog: Profile[]): { order: string[]; clashes: MergeClash[] } {
  const byName = new Map(catalog.map((p) => [p.name, p]));
  for (const name of selected) {
    if (!byName.has(name)) throw new UnknownProfileError(name);
  }
  if (!byName.has(BASE_PROFILE)) throw new UnknownProfileError(BASE_PROFILE);
  const rest = [...new Set(selected)].filter((n) => n !== BASE_PROFILE).sort();
  const order = [BASE_PROFILE, ...rest];

  const clashes: MergeClash[] = [];
  for (const kind of ['skill', 'agent'] as const) {
    const owners = new Map<string, string[]>();
    for (const name of order) {
      const profile = byName.get(name)!;
      for (const item of kind === 'skill' ? profile.skills : profile.agents) {
        owners.set(item, [...(owners.get(item) ?? []), name]);
      }
    }
    for (const [item, names] of [...owners].sort(([a], [b]) => a.localeCompare(b))) {
      if (names.length > 1) {
        clashes.push({ kind, name: item, winner: names[names.length - 1]!, losers: names.slice(0, -1) });
      }
    }
  }
  return { order, clashes };
}

