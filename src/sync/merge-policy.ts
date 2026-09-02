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
 * Whether a pulled row REPLACED something the user could already see.
 *
 * Corrupt local timestamps must not make a valid server row lose forever.
 *
 * Deliberately stricter than `remoteWinsLww`, which accepts an equal
 * `updated_at` so a re-pulled row converges. That equality is exactly the shape
 * of this device's OWN push coming back: the acknowledgement already stored the
 * server's timestamp locally, so the row arrives identical. Telling the user
 * "another device changed this" for their own save would be noise, so a
 * notification needs a row that existed locally AND a strictly newer remote
 * version (or a newer delete generation). A first pull into an empty workspace
 * has no local row and therefore never announces anything.
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
 * A pull cursor: everything at or before this `(updated_at, id)` is consumed.
 *
 * Stored in `sync_state.last_pulled_at` as `"<iso>|<uuid>"`. A bare ISO string
 * is the legacy single-column form and carries no tie-breaker, which is why
 * `id` is `""` rather than null — the empty string can never equal a real row
 * id, so a legacy cursor always compares as "behind" and re-pulls its own
 * timestamp once. The LWW merge makes that replay idempotent.
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

/**
 * Whether a cursor already stands on the newest row the server holds, so the
 * table can be skipped without asking PostgREST for a page that would be empty.
 *
 * `head` is one row of `public.sync_cursors()` (migration 32): the greatest
 * `(updated_at, id)` in that table for this user, or null when the table holds
 * nothing for them. A table the probe did not report at all is NOT null here —
 * the caller must treat an unreported table as "pull it", because the probe's
 * table list is a second copy of `SYNCED_TABLES` and a copy can fall behind.
 *
 * The comparison is deliberately narrower than the keyset filter the pull
 * itself uses. It skips only on an exact match of both halves, rather than on
 * "head is not greater than cursor", because the two values do not carry the
 * same precision: Postgres keeps `updated_at` to microseconds and the stored
 * cursor is `Date#toISOString`, which truncates to milliseconds. Under a
 * "not greater" test a row written 400µs after the cursor's row would compare
 * equal and be skipped forever, while the PostgREST filter — which compares at
 * full precision inside the database — would have returned it. An exact match
 * on the id proves the cursor is standing on that very row, and no precision
 * can hide behind it. Anything else pulls, and the pull decides.
 */
export function cursorIsAtServerHead(cursor: PullCursor, head: PullCursor | null): boolean {
  if (head == null) return true;
  if (head.id !== cursor.id) return false;
  const headTs = Date.parse(head.ts);
  // NaN on either side compares false, so an unparseable timestamp pulls.
  return Number.isFinite(headTs) && headTs === Date.parse(cursor.ts);
}
