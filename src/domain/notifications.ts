/** Pure guards shared by local-notification planning, tap routing and tests. */

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

/** Queue destructive queue replacements. Two foreground/session triggers may
 * request a rebuild together; allowing their cancel/schedule loops to overlap
 * leaves duplicate OS notifications even though each plan is unique itself. */
export function createNotificationReplacementQueue() {
  let tail: Promise<void> = Promise.resolve();
  return function replace<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task, task);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}

interface NotificationContent {
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

// ---------------------------------------------------------------------------
// Tap routing
// ---------------------------------------------------------------------------

/**
 * What a scheduled notification is about, carried in its `data` payload so a
 * tap can open the thing it named instead of wherever the app happened to be.
 *
 * A target is an IDENTITY, never a route and never a copy of the notification's
 * words. Two reasons, and both are load-bearing:
 *
 * - The payload outlives the app. It sits in the OS notification store for up
 *   to the scheduling horizon and is readable by anything that can read the
 *   notification, so it must never carry an amount, a rule name or a balance —
 *   the same rule the visible copy follows under `privateNotificationContent`,
 *   applied to the part of the notification the user cannot see.
 * - A stored route string is a route this app would later be asked to follow
 *   from outside its own code. A closed union mapped by `notificationRoute` is
 *   an allowlist by construction, and it survives a route rename.
 */
export type NotificationTarget =
  | { kind: "expected" }
  | { kind: "subscription"; id: string }
  | { kind: "installmentPlan"; id: string };

/** The key the payload is stored under, namespaced so nothing else claims it. */
const TARGET_KEY = "helixTarget";

export function notificationTargetPayload(target: NotificationTarget): Record<string, unknown> {
  return { [TARGET_KEY]: target };
}

/**
 * Read a target back out of an OS payload.
 *
 * Everything here is untrusted: the payload may predate an app update, name a
 * record that has since been deleted, or be absent entirely on a notification
 * scheduled by an older build. Unrecognised input returns null rather than a
 * guessed destination — sending someone to a plausible-looking wrong record is
 * worse than sending them nowhere.
 */
export function readNotificationTarget(data: unknown): NotificationTarget | null {
  if (typeof data !== "object" || data === null) return null;
  const raw = (data as Record<string, unknown>)[TARGET_KEY];
  if (typeof raw !== "object" || raw === null) return null;
  const { kind, id } = raw as { kind?: unknown; id?: unknown };
  if (kind === "expected") return { kind: "expected" };
  if (kind !== "subscription" && kind !== "installmentPlan") return null;
  return typeof id === "string" && id.trim() !== "" ? { kind, id } : null;
}

/** Where a target opens. One switch, so every destination is declared here. */
export function notificationRoute(
  target: NotificationTarget,
): { pathname: string; params?: Record<string, string> } {
  switch (target.kind) {
    case "subscription":
      return { pathname: "/subscription-form", params: { id: target.id } };
    case "installmentPlan":
      return { pathname: "/installment-new", params: { id: target.id } };
    case "expected":
      return { pathname: "/upcoming" };
  }
}

/** The whole tap decision: an OS payload in, a route or nothing out. */
export function notificationTapRoute(
  data: unknown,
): { pathname: string; params?: Record<string, string> } | null {
  const target = readNotificationTarget(data);
  return target ? notificationRoute(target) : null;
}

/**
 * The target a notification may carry once privacy is applied.
 *
 * With details off the visible copy collapses to one neutral reminder per day
 * (`privateNotificationContent` + `uniqueNotifications`), so the surviving
 * notification no longer stands for one specific record — and a payload naming
 * one would both re-attach the identity the user just hid and send a tap to an
 * arbitrary member of that day's group. The day-level list is the honest
 * destination.
 */
export function privateNotificationTarget(
  detailsEnabled: boolean,
  target: NotificationTarget,
): NotificationTarget {
  return detailsEnabled ? target : { kind: "expected" };
}
