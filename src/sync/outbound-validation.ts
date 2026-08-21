import { parseDefinition } from "../domain/computed-columns";
import type { SyncedTableName } from "../db/schema";
import { isValidImportRow } from "../services/backup-validation";
import {
  classifyOutboxBatch,
  type OutboxEvent,
  type ParsedOutboxEvent,
  type RejectedOutboxEvent,
} from "./merge-policy";

type OutboundConversion =
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; reason: "invalid_row" };

interface OutboundPolicy {
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
  if (!isValidImportRow(table, out, { enforceInputLimits: true })) {
    return { ok: false, reason: "invalid_row" };
  }
  // SQLite stores booleans as 0/1 and PostgREST wants real booleans, so this
  // COERCES rather than validates. It does not re-check the value because it
  // cannot fail: `isValidImportRow` above refuses any `SQLiteBoolean` column
  // that is not 0, 1 or a boolean, and `booleanColumnsOf` derives this set from
  // the same `getTableColumns` source. The old rejection branch was therefore
  // unreachable, which is exactly why no test ever covered it; the property
  // that makes removing it safe is pinned in `tests/sync-outbound.test.ts`.
  for (const column of policy.booleanColumns) {
    if (column in out && out[column] !== null) out[column] = Boolean(out[column]);
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
  // Nothing `isValidImportRow` already refuses is re-checked here. It runs
  // above and is now strictly stronger on every table this pushes, including
  // the negative cost basis that used to be this function's one exception.
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
  if (table === "investment_operations") {
    const priority = (kind: unknown) =>
      kind === "existing" ? 0 : kind === "sell" ? 2 : 1;
    rows.sort((a, b) =>
      String(a.operation_date).localeCompare(String(b.operation_date))
      || priority(a.kind) - priority(b.kind)
      || String(a.id).localeCompare(String(b.id)),
    );
  }
  return { rows, pushedEvents, rejected };
}
