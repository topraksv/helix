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
