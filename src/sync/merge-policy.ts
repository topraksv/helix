/** Pure sync selection rules, kept outside I/O so conflict edges are testable. */

export interface OutboxEvent {
  id: number;
  payload: string;
  row_id: string;
}

export interface ParsedOutboxEvent extends OutboxEvent {
  row: Record<string, unknown>;
}

export interface RejectedOutboxEvent extends OutboxEvent {
  reason: "malformed_payload" | "wrong_user" | "invalid_row";
}

export function classifyOutboxBatch(
  events: OutboxEvent[],
  userId: string,
): { latestByRow: Map<string, ParsedOutboxEvent>; rejected: RejectedOutboxEvent[] } {
  const latestByRow = new Map<string, ParsedOutboxEvent>();
  const rejected: RejectedOutboxEvent[] = [];
  for (const event of events) {
    // Events arrive oldest-first. Remove the prior candidate immediately so a
    // newer corrupt snapshot can never cause an older valid value to be sent.
    latestByRow.delete(event.row_id);
    let row: unknown;
    try {
      row = JSON.parse(event.payload);
    } catch {
      rejected.push({ ...event, reason: "malformed_payload" });
      continue;
    }
    if (
      !row ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      typeof (row as { id?: unknown }).id !== "string" ||
      (row as { id: string }).id !== event.row_id
    ) {
      rejected.push({ ...event, reason: "malformed_payload" });
      continue;
    }
    if ((row as { user_id?: unknown }).user_id !== userId) {
      rejected.push({ ...event, reason: "wrong_user" });
      continue;
    }
    latestByRow.set(event.row_id, { ...event, row: row as Record<string, unknown> });
  }
  return { latestByRow, rejected };
}

/** Server timestamps are authoritative after a push. Do not apply an ack over
 *  a local edit that entered the outbox while the request was in flight. */
export function shouldApplyServerAck(pushedOutboxId: number, newestOutboxId: number | null): boolean {
  return newestOutboxId == null || newestOutboxId <= pushedOutboxId;
}

/** Every synced row id is UUID-shaped (UUIDv7 or the deterministic v8-nibble
 *  form). Pull embeds the last row's id into a PostgREST `.or()` filter string
 *  as the keyset cursor, so an id containing filter grammar (`,`, `(`, `)`)
 *  must never get that far — validate the shape, not just `typeof`. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidShaped(id: unknown): id is string {
  return typeof id === "string" && UUID_SHAPE.test(id);
}

/**
 * Whether a pulled row replaced something the user could already see. Stricter than `remoteWinsLww`, which
 * accepts an equal `updated_at`: that is this device's own push coming back, and announcing it would be
 * noise. It needs a local row and a strictly newer remote version or delete generation.
 */
export function remoteSupersededLocal(
  localUpdatedAt: string | null,
  remoteUpdatedAt: string,
  localTombstoneVersion = 0,
  remoteTombstoneVersion = 0,
): boolean {
  if (localUpdatedAt == null) return false;
  if (remoteTombstoneVersion !== localTombstoneVersion) {
    return remoteTombstoneVersion > localTombstoneVersion;
  }
  const remote = Date.parse(remoteUpdatedAt);
  const local = Date.parse(localUpdatedAt);
  return Number.isFinite(remote) && Number.isFinite(local) && remote > local;
}

export function remoteWinsLww(
  localUpdatedAt: string | null,
  remoteUpdatedAt: string,
  localTombstoneVersion = 0,
  remoteTombstoneVersion = 0,
): boolean {
  // Delete generations are server-coordinated and dominate wall clocks. A
  // stale device may submit a later timestamp after being offline, but if it
  // never observed generation N+1 it cannot revive or overwrite that delete.
  if (remoteTombstoneVersion !== localTombstoneVersion) {
    return remoteTombstoneVersion > localTombstoneVersion;
  }
  const remote = Date.parse(remoteUpdatedAt);
  if (!Number.isFinite(remote)) return false;
  if (!localUpdatedAt) return true;
  const local = Date.parse(localUpdatedAt);
  return !Number.isFinite(local) || remote >= local;
}

/**
 * A pull cursor: everything at or before this `(updated_at, id)` is consumed, stored as `"<iso>|<uuid>"`.
 * A bare ISO string is the legacy form: its `id` is `""`, which never equals a real id, so it re-pulls its
 * own timestamp once and the LWW merge makes the replay idempotent.
 */
export interface PullCursor {
  ts: string;
  id: string;
}

/** The cursor a table starts from before it has ever been pulled. */
export const PULL_EPOCH = "1970-01-01T00:00:00.000Z";

export function parsePullCursor(raw: string | null | undefined): PullCursor {
  const value = raw || PULL_EPOCH;
  const separator = value.indexOf("|");
  return separator >= 0
    ? { ts: value.slice(0, separator), id: value.slice(separator + 1) }
    : { ts: value, id: "" };
}

export function formatPullCursor(cursor: PullCursor): string {
  return `${cursor.ts}|${cursor.id}`;
}

/** A pull cursor's instant at the server's microsecond precision; cut to the millisecond, `updated_at.gt` would match a page stamped by one `now()` again for ever. */
export function cursorInstant(value: string): string {
  const sub = /T[\d:]+\.\d{3}(\d{1,3})/.exec(value)?.[1] ?? "";
  return new Date(value).toISOString().replace("Z", `${sub}Z`);
}

/**
 * Whether a cursor already stands on the newest row the server holds (`head`, a row of `sync_cursors()`, or
 * null when the table is empty for the user), so the table is skipped. An unreported table is not null: the
 * caller pulls it. Skips only on an exact match of both halves: Postgres keeps microseconds and the cursor
 * milliseconds, so "head not greater than cursor" would skip a row written 400µs later for ever.
 */
export function cursorIsAtServerHead(cursor: PullCursor, head: PullCursor | null): boolean {
  if (head == null) return true;
  if (head.id !== cursor.id) return false;
  const headTs = Date.parse(head.ts);
  // NaN on either side compares false, so an unparseable timestamp pulls.
  return Number.isFinite(headTs) && headTs === Date.parse(cursor.ts);
}
