import { parseDefinition } from "../domain/computed-columns";
import type { SyncedTableName } from "../db/schema";
import {
  classifyOutboxBatch,
  type OutboxEvent,
  type ParsedOutboxEvent,
  type RejectedOutboxEvent,
} from "./merge-policy";

type OutboundConversion =
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; reason: "invalid_row" };

export interface OutboundPolicy {
  allowedColumns: ReadonlySet<string>;
  booleanColumns: ReadonlySet<string>;
}

function finiteNumeric(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Validate and coerce one SQLite outbox snapshot before it can enter a
 * PostgREST batch. A single corrupt inner JSON/numeric field must be
 * quarantinable without making every later event retry forever.
 */
export function convertOutboundRow(
  table: SyncedTableName,
  row: Record<string, unknown>,
  policy: OutboundPolicy,
): OutboundConversion {
  if (Object.keys(row).some((column) => !policy.allowedColumns.has(column))) {
    return { ok: false, reason: "invalid_row" };
  }

  const out: Record<string, unknown> = { ...row };
  for (const column of policy.booleanColumns) {
    if (column in out && out[column] !== null) {
      if (![true, false, 0, 1].includes(out[column] as boolean | number)) {
        return { ok: false, reason: "invalid_row" };
      }
      out[column] = Boolean(out[column]);
    }
  }

  try {
    if (table === "computed_columns") {
      const raw = out.definition;
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      parseDefinition(parsed);
      out.definition = parsed;
    }
  } catch {
    return { ok: false, reason: "invalid_row" };
  }

  if (table === "transactions" && out.fx_rate != null) {
    const rate = finiteNumeric(out.fx_rate);
    if (rate == null || rate <= 0) return { ok: false, reason: "invalid_row" };
    out.fx_rate = rate;
  }
  if (table === "fx_rates") {
    const rate = finiteNumeric(out.rate_try);
    if (rate == null || rate <= 0) return { ok: false, reason: "invalid_row" };
    out.rate_try = rate;
  }

  return { ok: true, row: out };
}

export function prepareOutboundBatch(
  table: SyncedTableName,
  events: OutboxEvent[],
  userId: string,
  policy: OutboundPolicy,
): {
  rows: Record<string, unknown>[];
  pushedEvents: ParsedOutboxEvent[];
  rejected: RejectedOutboxEvent[];
} {
  const classified = classifyOutboxBatch(events, userId);
  const rejected = [...classified.rejected];
  const pushedEvents: ParsedOutboxEvent[] = [];
  const rows: Record<string, unknown>[] = [];
  for (const event of classified.latestByRow.values()) {
    const converted = convertOutboundRow(table, event.row, policy);
    if (!converted.ok) {
      rejected.push({ ...event, reason: converted.reason });
      continue;
    }
    pushedEvents.push(event);
    rows.push(converted.row);
  }
  return { rows, pushedEvents, rejected };
}
