import { getTableColumns } from "drizzle-orm";
import { parseDefinition } from "../domain/computed-columns";
import { SYNCED_TABLES, type SyncedTableName } from "../db/schema";
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
  /**
   * The columns an update added before the pull after it finished, each with
   * the value the migration gave every row. A row holding that value may hold
   * it only because it was pulled before the column existed, so the column is
   * left out and the server keeps its own (`src/db/schema.ts` `UNPULLED`).
   */
  unpulled?: ReadonlyMap<string, unknown>;
}

const POLICIES = new Map<SyncedTableName, OutboundPolicy>();

/** The columns and booleans of `table` in this build's schema; the push and a dead letter's retry judge by the same sets. */
export function outboundPolicy(table: SyncedTableName): OutboundPolicy {
  let policy = POLICIES.get(table);
  if (!policy) {
    const columns = Object.values(getTableColumns(SYNCED_TABLES[table]));
    policy = {
      allowedColumns: new Set(columns.map((column) => column.name)),
      booleanColumns: new Set(columns.filter((column) => column.columnType === "SQLiteBoolean").map((column) => column.name)),
    };
    POLICIES.set(table, policy);
  }
  return policy;
}

function finiteNumeric(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function leaveOutUnpulled(row: Record<string, unknown>, unpulled: ReadonlyMap<string, unknown> = new Map()): void {
  for (const [column, empty] of unpulled) {
    if (column in row && (row[column] ?? null) === empty) delete row[column];
  }
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
  // PostgREST wants real booleans. No re-check: `isValidImportRow` above already
  // refuses a boolean column that is not 0, 1 or a boolean.
  for (const column of policy.booleanColumns) {
    if (column in out && out[column] !== null) out[column] = Boolean(out[column]);
  }
  leaveOutUnpulled(out, policy.unpulled);

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
