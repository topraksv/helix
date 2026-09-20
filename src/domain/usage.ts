/**
 * A route turned into a name that can be counted, with nothing in it that
 * belongs to anybody.
 *
 * `usage_counters` answers one question — which screens get opened — and the
 * database refuses anything that does not match its shape. This is where that
 * shape is produced, and it is deliberately subtractive: a segment that could
 * be an identifier is DROPPED rather than replaced with a placeholder, because
 * `cash-flow.2026-09` and `cash-flow.:month` both leak the fact that a month
 * was opened while only one of them is short. What survives is the screen.
 *
 * Group markers lose their parentheses (`(tabs)` → `tabs`) because the shape
 * rule has no room for them and because a group is a real place in the app.
 */

/** Matches the CHECK constraint in migration 41. Enforced here too, so a bad
 *  key is dropped on the device rather than rejected after a network round
 *  trip that the counter is not allowed to cost. */
const SCREEN_SHAPE = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)*$/;
const MAX_LENGTH = 60;

/** A segment that identifies a row, a month or a person rather than a screen. */
function isIdentifier(segment: string): boolean {
  return (
    /^\d+$/.test(segment) ||
    /^\d{4}-\d{2}(-\d{2})?$/.test(segment) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(segment) ||
    /^\[.+\]$/.test(segment) ||
    segment.length > 24
  );
}

/**
 * The counted name for a pathname, or null when nothing countable is left.
 *
 * Returns null rather than a fallback for an unrecognisable route: a bucket
 * called `unknown` accumulates every mistake into one number that reads like a
 * real screen.
 */
export function screenKey(pathname: string): string | null {
  const withoutQuery = pathname.split(/[?#]/)[0] ?? "";
  const segments = withoutQuery
    .split("/")
    .map((segment) => segment.replace(/^\((.*)\)$/, "$1").trim().toLowerCase())
    .filter((segment) => segment.length > 0 && !isIdentifier(segment))
    .map((segment) => segment.replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, ""))
    .filter((segment) => segment.length > 0);
  const key = segments.length === 0 ? "root" : segments.join(".");
  const trimmed = key.slice(0, MAX_LENGTH).replace(/\.$/, "");
  return SCREEN_SHAPE.test(trimmed) ? trimmed : null;
}

/**
 * One day's counts for one screen, as the server's `record_usage` takes them.
 *
 * A type alias rather than an interface, and that is load-bearing: the
 * generated Supabase `Json` parameter is an index signature, and TypeScript
 * will not assign an interface to one. Declaring it this way is what lets the
 * RPC take these rows without the double cast `tests/repo/architecture-contract.test.ts`
 * refuses in the layers that decide what gets written.
 */
export type UsageDelta = {
  day: string;
  screen: string;
  count: number;
};

/** The device's local day, which is the day the visit happened for the person
 *  who made it. A server-side `current_date` would move an evening visit into
 *  tomorrow for anyone west of UTC. */
export function localDay(at: Date = new Date()): string {
  const year = at.getFullYear();
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Whether a stored delta still matches what the server will accept. Storage
 *  survives an app upgrade, so a shape that changed between versions must be
 *  dropped here rather than rejected there. */
export function isUsageDelta(value: unknown): value is UsageDelta {
  if (typeof value !== "object" || value === null) return false;
  const delta = value as Partial<UsageDelta>;
  return (
    typeof delta.day === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(delta.day) &&
    typeof delta.screen === "string" &&
    SCREEN_SHAPE.test(delta.screen) &&
    typeof delta.count === "number" &&
    Number.isInteger(delta.count) &&
    delta.count > 0 &&
    delta.count <= 10000
  );
}
