export type UsageWindow = { pct: number; resetsAt: Date | null };

export type UsageSnapshot = {
  fiveHour: UsageWindow;
  weekly: UsageWindow;
  extra: (UsageWindow & { label: string })[];
  fetchedAt: Date;
};
