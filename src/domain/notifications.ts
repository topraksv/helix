/** Pure guards shared by local-notification planning and tests. */

export function normalizeReminderDays(value: unknown, horizonDays: number): number {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.max(0, Math.min(horizonDays, value))
    : 3;
}

export function uniqueNotifications<T extends { date: string; title: string; body: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.date}\u0000${row.title}\u0000${row.body}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface NotificationContent {
  title: string;
  body: string;
}

/** Detailed lock-screen copy is an explicit device-local opt-in. */
export function privateNotificationContent(
  detailsEnabled: boolean,
  detailed: NotificationContent,
  neutral: NotificationContent,
): NotificationContent {
  return detailsEnabled ? detailed : neutral;
}

export function boundedScheduledNotifications<T extends { fireAt: Date }>(rows: T[], limit: number): T[] {
  return [...rows]
    .sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime())
    .slice(0, Math.max(0, limit));
}
