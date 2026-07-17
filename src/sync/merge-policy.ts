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
  reason: "malformed_payload" | "wrong_user";
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

/** Corrupt local timestamps must not make a valid server row lose forever. */
export function remoteWinsLww(localUpdatedAt: string | null, remoteUpdatedAt: string): boolean {
  const remote = Date.parse(remoteUpdatedAt);
  if (!Number.isFinite(remote)) return false;
  if (!localUpdatedAt) return true;
  const local = Date.parse(localUpdatedAt);
  return !Number.isFinite(local) || remote >= local;
}
